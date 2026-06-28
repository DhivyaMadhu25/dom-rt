"""
DOM-RT AI Anomaly Detection Service
Tier 3: Isolation Forest (scikit-learn)

Exposes:
  POST /predict   — score a site feature vector
  POST /train     — retrain model on current data
  GET  /health    — service health
  GET  /model     — model metadata
"""

import os
import json
import logging
import pickle
import numpy as np
from datetime import datetime, timezone

def _now_iso():
    return datetime.now(timezone.utc).isoformat()
from flask import Flask, request, jsonify
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

logging.basicConfig(level=logging.INFO, format='[AI] %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)

# ─── Model State ────────────────────────────────────────────
MODEL_VERSION  = '1.0.0'
_BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR   = os.path.join(_BASE_DIR, 'model')
MODEL_PATH  = os.path.join(MODEL_DIR, 'isolation_forest.pkl')
SCALER_PATH = os.path.join(MODEL_DIR, 'scaler.pkl')
META_PATH   = os.path.join(MODEL_DIR, 'meta.json')

model  = None
scaler = None
meta   = {}

FEATURE_NAMES = [
    'avg_open_delay',
    'activity_count',
    'total_amount',
    'open_alerts',
    'exception_count',
]

def load_model():
    global model, scaler, meta
    try:
        if os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH):
            with open(MODEL_PATH, 'rb') as f:
                model = pickle.load(f)
            with open(SCALER_PATH, 'rb') as f:
                scaler = pickle.load(f)
            with open(META_PATH, 'r') as f:
                meta = json.load(f)
            logger.info(f"Loaded model v{meta.get('version', '?')} trained on {meta.get('trained_at', '?')}")
        else:
            logger.info("No pre-trained model found — using default model")
            train_default_model()
    except Exception as e:
        logger.error(f"Error loading model: {e}")
        train_default_model()

def train_default_model():
    """Train on synthetic normal-behavior data as baseline."""
    global model, scaler, meta
    np.random.seed(42)
    n_samples = 1000

    # Simulate normal operational feature distributions
    X = np.column_stack([
        np.random.normal(5,   3,    n_samples).clip(0),   # avg_open_delay (minutes)
        np.random.normal(200, 50,   n_samples).clip(0),   # activity_count
        np.random.normal(5000, 1500, n_samples).clip(0),  # total_amount
        np.random.normal(1,   0.5,  n_samples).clip(0),   # open_alerts
        np.random.normal(2,   1,    n_samples).clip(0),   # exception_count
    ])

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = IsolationForest(
        n_estimators=100,
        max_samples='auto',
        contamination=0.05,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_scaled)

    meta = {
        'version':      MODEL_VERSION,
        'trained_at':   _now_iso(),
        'n_samples':    n_samples,
        'contamination': 0.05,
        'features':     FEATURE_NAMES,
        'description':  'Default model trained on synthetic normal operational data',
    }

    os.makedirs(MODEL_DIR, exist_ok=True)
    with open(MODEL_PATH, 'wb') as f: pickle.dump(model, f)
    with open(SCALER_PATH, 'wb') as f: pickle.dump(scaler, f)
    with open(META_PATH, 'w') as f: json.dump(meta, f, indent=2)
    logger.info("Default Isolation Forest model trained and saved")


def extract_features(feature_dict):
    """Extract ordered feature vector from request dict."""
    return [float(feature_dict.get(name, 0) or 0) for name in FEATURE_NAMES]


def compute_anomaly_score(raw_score):
    """
    Isolation Forest returns scores in (-inf, 0.5].
    Negative = more anomalous.
    Normalize to [0, 1] where 1 = most anomalous.
    """
    return float(np.clip(0.5 - raw_score, 0, 1))


def top_contributing_features(features_array, feature_names):
    """
    Identify which features deviate most from the training mean.
    Returns top-3 features as explanations.
    """
    if scaler is None:
        return {}
    scaled = scaler.transform([features_array])[0]
    deviations = {name: abs(float(val)) for name, val in zip(feature_names, scaled)}
    sorted_devs = sorted(deviations.items(), key=lambda x: x[1], reverse=True)
    return {k: round(v, 3) for k, v in sorted_devs[:3]}


# ─── Endpoints ──────────────────────────────────────────────

@app.route('/health')
def health():
    return jsonify({
        'status':        'ok',
        'model_loaded':  model is not None,
        'model_version': meta.get('version', 'none'),
        'timestamp':     _now_iso(),
    })

@app.route('/model')
def model_info():
    return jsonify(meta)

@app.route('/predict', methods=['POST'])
def predict():
    data = request.get_json()
    if not data or 'features' not in data:
        return jsonify({'error': 'features dict required'}), 400

    try:
        features_array = extract_features(data['features'])
        X = np.array([features_array])
        X_scaled = scaler.transform(X)

        raw_score    = float(model.score_samples(X_scaled)[0])
        anomaly_score = compute_anomaly_score(raw_score)
        is_anomaly   = anomaly_score > 0.6

        top_features = top_contributing_features(features_array, FEATURE_NAMES) if is_anomaly else {}

        result = {
            'site_id':       data.get('site_id'),
            'is_anomaly':    is_anomaly,
            'anomaly_score': round(anomaly_score, 4),
            'raw_score':     round(raw_score, 4),
            'top_features':  top_features,
            'model_version': meta.get('version', MODEL_VERSION),
            'predicted_at':  _now_iso(),
        }

        logger.info(f"Predicted site={data.get('site_id','?')} anomaly={is_anomaly} score={anomaly_score:.3f}")
        return jsonify(result)

    except Exception as e:
        logger.error(f"Prediction error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/train', methods=['POST'])
def retrain():
    """
    Accepts training samples: {"samples": [[f1,f2,...], ...]}
    Retrains the model and saves it.
    """
    data = request.get_json()
    samples = data.get('samples', [])

    if len(samples) < 50:
        return jsonify({'error': 'At least 50 samples required for retraining'}), 400

    try:
        X = np.array(samples, dtype=float)
        new_scaler = StandardScaler()
        X_scaled   = new_scaler.fit_transform(X)

        new_model = IsolationForest(
            n_estimators=100,
            contamination=0.05,
            random_state=42,
            n_jobs=-1,
        )
        new_model.fit(X_scaled)

        global model, scaler, meta
        model  = new_model
        scaler = new_scaler
        meta.update({
            'version':    f"1.{len(samples)}",
            'trained_at': _now_iso(),
            'n_samples':  len(samples),
        })

        with open(MODEL_PATH, 'wb') as f: pickle.dump(model, f)
        with open(SCALER_PATH, 'wb') as f: pickle.dump(scaler, f)
        with open(META_PATH, 'w') as f: json.dump(meta, f, indent=2)

        logger.info(f"Model retrained on {len(samples)} samples. Version: {meta['version']}")
        return jsonify({'status': 'retrained', 'version': meta['version'], 'samples': len(samples)})

    except Exception as e:
        logger.error(f"Retraining error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/batch_predict', methods=['POST'])
def batch_predict():
    """Score multiple sites at once for bulk anomaly scanning."""
    data = request.get_json()
    sites = data.get('sites', [])
    results = []

    for site in sites:
        try:
            features_array = extract_features(site.get('features', {}))
            X_scaled = scaler.transform([features_array])
            raw_score     = float(model.score_samples(X_scaled)[0])
            anomaly_score = compute_anomaly_score(raw_score)
            results.append({
                'site_id':       site.get('site_id'),
                'anomaly_score': round(anomaly_score, 4),
                'is_anomaly':    anomaly_score > 0.6,
            })
        except Exception:
            results.append({'site_id': site.get('site_id'), 'error': 'prediction_failed'})

    return jsonify({'results': results, 'count': len(results)})


# ─── Start ───────────────────────────────────────────────────
load_model()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    logger.info(f"DOM-RT AI Service starting on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
