# app.py
import os
from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename
import cv2
import numpy as np
import librosa
import tensorflow as tf
from tensorflow.keras.models import load_model # type: ignore
import joblib
import base64
import shap
from flask_cors import CORS


app = Flask(__name__)
CORS(
    app,
    origins=[
        "https://integrify.live", 
        "https://integrify-dc501.web.app"
    ],
    methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"]
)

# Root route
@app.route("/", methods=["GET"])
def home():
    return jsonify({"status": "Backend is running"})

# Health check route
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "Backend is healthy"})

# -------------------------
# Configuration
# -------------------------
UPLOAD_FOLDER = "uploads"
ALLOWED_VIDEO_EXTENSIONS = {"mp4", "mov", "avi"}
ALLOWED_AUDIO_EXTENSIONS = {"wav", "mp3"}
IMG_SIZE = 224

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

# -------------------------
# Load Models
# -------------------------
video_model = load_model("models/trainedModel.keras")
audio_model = joblib.load("models/audio_rf_model.pkl")

# -------------------------
# MFCC Mapping for user-friendly text
# -------------------------
MFCC_DESCRIPTIONS = {
    0: "low tone or bass",
    1: "slightly higher pitch",
    2: "moderate pitch variation",
    3: "fast pitch changes",
    4: "voice energy in middle frequencies",
    5: "slightly high pitch energy",
    6: "high pitch variation",
    7: "sudden tone changes",
    8: "upper-mid frequency energy",
    9: "irregular voice patterns",
    10: "sharp pitch spikes",
    11: "steady tone",
    12: "overall voice intensity"
}

# -------------------------
# Utility functions
# -------------------------
def allowed_file(filename, file_type="video"):
    if file_type == "video":
        return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_VIDEO_EXTENSIONS
    else:
        return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_AUDIO_EXTENSIONS

def to_base64(img):
    _, buffer = cv2.imencode(".png", img)
    return base64.b64encode(buffer).decode("utf-8")

# -------------------------
# Grad-CAM Heatmap for video
# -------------------------
def get_gradcam_heatmap(model, img_array):
    img_tensor = tf.convert_to_tensor(img_array, dtype=tf.float32)
    last_conv_layer = model.layers[-4]
    grad_model = tf.keras.models.Model([model.inputs], [last_conv_layer.output, model.output])

    with tf.GradientTape() as tape:
        conv_outputs, predictions = grad_model(img_tensor)
        conv_outputs = tf.convert_to_tensor(conv_outputs)
        predictions = tf.convert_to_tensor(predictions)
        loss = predictions[:, 0]

    grads = tape.gradient(loss, conv_outputs)
    pooled_grads = tf.reduce_mean(grads, axis=(0, 1, 2))

    conv_outputs = conv_outputs[0]
    heatmap = conv_outputs @ pooled_grads[..., tf.newaxis]
    heatmap = tf.squeeze(heatmap)
    heatmap = tf.maximum(heatmap, 0) / (tf.reduce_max(heatmap) + 1e-8)
    heatmap = cv2.resize(heatmap.numpy(), (IMG_SIZE, IMG_SIZE))
    heatmap = np.uint8(255 * heatmap)
    return heatmap

# -------------------------
# Video Prediction + XAI
# -------------------------
def predict_video_with_xai(video_path, max_frames=25):
    cap = cv2.VideoCapture(video_path)
    frames = []
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    interval = max(1, total // max_frames)
    idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % interval == 0:
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frame_resized = cv2.resize(frame_rgb, (IMG_SIZE, IMG_SIZE))
            frame_resized = frame_resized.astype("float32") / 255.0
            frames.append(frame_resized)
        idx += 1
    cap.release()

    if len(frames) == 0:
        return {"error": "No frames extracted"}

    frames_array = np.array(frames)
    probs = video_model.predict(frames_array, verbose=0).reshape(-1)
    avg_prob = float(np.mean(probs))
    label = "REAL" if avg_prob >= 0.5 else "FAKE"

    top_indices = np.argsort(probs)[-3:]
    top_frames_b64 = []

    for i in top_indices:
        frame_input = np.expand_dims(frames_array[i], axis=0)
        heatmap = get_gradcam_heatmap(video_model, frame_input)
        frame_bgr = cv2.cvtColor((frames_array[i]*255).astype(np.uint8), cv2.COLOR_RGB2BGR)
        heatmap_color = cv2.applyColorMap(heatmap, cv2.COLORMAP_JET)
        superimposed = cv2.addWeighted(frame_bgr, 0.6, heatmap_color, 0.4, 0)
        top_frames_b64.append(to_base64(superimposed))

    return {
        "average_probability": avg_prob,
        "label": label,
        "frames_used": len(frames),
        "top_frames": top_frames_b64
    }

# -------------------------
# Audio Prediction + Explainable AI (user-friendly)
# -------------------------
def extract_features(file_path):
    audio, sample_rate = librosa.load(file_path, sr=None)
    mfccs = librosa.feature.mfcc(y=audio, sr=sample_rate, n_mfcc=13)
    return np.mean(mfccs.T, axis=0)

def explain_audio_user_friendly(file_path, top_n=3):
    features = extract_features(file_path).reshape(1, -1)
    pred = audio_model.predict(features)
    label = "FAKE" if pred[0] == 1 else "REAL"

    confidence_score = None
    if hasattr(audio_model, "predict_proba"):
        proba = audio_model.predict_proba(features)[0]
        fake_prob = float(proba[1]) if len(proba) > 1 else float(proba[0])
        real_prob = float(proba[0]) if len(proba) > 1 else 1.0 - fake_prob
        confidence_score = fake_prob if label == "FAKE" else real_prob

    explainer = shap.TreeExplainer(audio_model)
    shap_values = explainer.shap_values(features)

    # Fix for binary classifier: handle case shap_values has length 1
    shap_array = shap_values[1] if isinstance(shap_values, list) and len(shap_values) > 1 else shap_values[0]

    top_indices = np.argsort(np.abs(shap_array[0]))[::-1][:top_n]

    parts = []
    for idx in top_indices:
        desc = MFCC_DESCRIPTIONS.get(idx, f"feature #{idx}")
        importance = shap_array[0][idx]
        if label == "FAKE" and importance > 0:
            parts.append(desc)
        elif label == "REAL" and importance < 0:
            parts.append(desc)

    if parts:
        features_text = ", ".join(parts)
        if label == "FAKE":
            explanation = f"The AI detected unusual voice patterns, such as {features_text}, which contributed to predicting this audio as FAKE."
        else:
            explanation = f"The AI detected stable and natural voice patterns, like {features_text}, which contributed to predicting this audio as REAL."
    else:
        explanation = f"The AI analysed the audio and predicted it as {label} based on overall voice characteristics."

    payload = {"label": label, "explanation": explanation}
    if confidence_score is not None:
        payload["confidence"] = confidence_score

    return payload

# -------------------------
# Flask Routes
# -------------------------
@app.route("/predict/video", methods=["POST"])
def handle_video():
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file part"}), 400
        file = request.files["file"]
        if file.filename == "" or not allowed_file(file.filename, "video"):
            return jsonify({"error": "Invalid file"}), 400

        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(filepath)

        result = predict_video_with_xai(filepath)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/predict/audio", methods=["POST"])
def handle_audio():
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file part"}), 400
        file = request.files["file"]
        if file.filename == "" or not allowed_file(file.filename, "audio"):
            return jsonify({"error": "Invalid file"}), 400

        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        file.save(filepath)

        result = explain_audio_user_friendly(filepath)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# -------------------------
# Run Flask App
# -------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))  # Use DO's PORT if available
    app.run(host="0.0.0.0", port=port)
