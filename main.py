from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from ultralytics import YOLO
from PIL import Image
from pathlib import Path
import io
import os

app = FastAPI()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent

# Load model
model = YOLO(BASE_DIR / "best.pt")

# Serve frontend
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def serve_home():
    return FileResponse("static/index.html")

@app.get("/{page}.html")
def serve_page(page: str):
    file = BASE_DIR / "static" / f"{page}.html"
    if file.exists():
        return FileResponse(str(file))
    return FileResponse("static/index.html")

@app.get("/classes")
def get_classes():
    return {"classes": model.names}

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")

    results = model(image, conf=0.25, verbose=False)[0]

    boxes = []
    for box in results.boxes:
        x1, y1, x2, y2 = map(float, box.xyxy[0])
        conf = float(box.conf[0])
        cls = int(box.cls[0])

        boxes.append({
            "x1": x1,
            "y1": y1,
            "x2": x2,
            "y2": y2,
            "confidence": round(conf * 100, 1),
            "label": model.names[cls]
        })

    return {
        "boxes": boxes,
        "has_detections": len(boxes) > 0
    }