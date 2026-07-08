import { auth, db, storage } from "./firebase.js"; 
import { showAlert, showLoading, updateLoading, hideAlert } from "./notify.js";
import { isGuestMode } from "./auth.js";
import { addDoc, collection, query, where, getDocs, orderBy, deleteDoc, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-storage.js";

const BACKEND_URL = "https://api.integrify.live";
const AUTH_WAIT_TIMEOUT = 3000;
const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const fileInfo = document.getElementById('fileInfo');
const continueBtn = document.getElementById('continueBtn');
const fileSection = document.querySelector(".file-section");
const resultVideo = document.getElementById("resultVideo");
const filenameLabel = document.querySelector(".filename");
const progressPlayed = document.querySelector(".progress .played");
const currentTimeLabel = document.querySelector(".time-row span:first-child");
const durationLabel = document.querySelector(".time-row span:last-child");
const playPauseBtn = document.getElementById("playPauseBtn");
const playPauseIcon = document.getElementById("playPauseIcon");
const rewindBtn = document.getElementById("rewindBtn");
const forwardBtn = document.getElementById("forwardBtn");
const saveBtn = document.querySelector(".btn-save");
const deleteBtn = document.querySelector(".btn-delete");
const heatmapGallery = document.getElementById("heatmapGallery");
const heatmapModal = document.getElementById("heatmapModal");
const heatmapModalImage = document.getElementById("heatmapModalImage");
const heatmapModalClose = document.getElementById("heatmapModalClose");
const heatmapModalBackdrop = document.getElementById("heatmapModalBackdrop");
const SEEK_INTERVAL = 10;
let currentMediaUrl = null;
let selectedFile = null;
let lastSavedEntry = null;
let currentHeatmaps = [];
let lastHeatmapTrigger = null;
let activeHeatmapIndex = -1;
if (uploadArea && fileInput) {
    uploadArea.addEventListener('dragover', (event) => {
        event.preventDefault();
        uploadArea.classList.add('dragging');
    });
    uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragging'));
    uploadArea.addEventListener('drop', (event) => {
        event.preventDefault();
        uploadArea.classList.remove('dragging');
        if (event.dataTransfer?.files?.length && fileInput) {
            fileInput.files = event.dataTransfer.files;
            handleFileSelection();
        }
    });
}

if (fileInput) {
    fileInput.addEventListener('change', handleFileSelection);
}

clearFileSelection();
renderHeatmap(null);

const originalShowUploadPage = typeof window.showUploadPage === "function" ? window.showUploadPage : null;
if (originalShowUploadPage) {
    window.showUploadPage = function (...args) {
        clearFileSelection();
        lastSavedEntry = null;
        return originalShowUploadPage.apply(this, args);
    };
}

// --------------------
// Ensure Firebase auth is hydrated before uploading
// --------------------
async function requireAuthenticatedUser() {
    if (typeof isGuestMode === "function" && isGuestMode()) {
        return null;
    }
    if (auth.currentUser) {
        return auth.currentUser;
    }

    let unsubscribe = () => {};
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            unsubscribe();
            resolve(null);
        }, AUTH_WAIT_TIMEOUT);

        unsubscribe = auth.onAuthStateChanged((user) => {
            clearTimeout(timer);
            unsubscribe();
            resolve(user);
        });
    });
}

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function setPlayPauseIcon(paused) {
    if (!playPauseIcon) return;
    playPauseIcon.textContent = paused ? "▶" : "❚❚";
    playPauseBtn?.setAttribute("aria-label", paused ? "Play" : "Pause");
}

function updateProgressUI() {
    if (!resultVideo || !progressPlayed) return;
    const { currentTime, duration } = resultVideo;
    const percent = duration ? (currentTime / duration) * 100 : 0;
    progressPlayed.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    if (currentTimeLabel) currentTimeLabel.textContent = formatTime(currentTime);
    if (durationLabel) durationLabel.textContent = formatTime(duration);
}

function resetPlayerUI() {
    if (progressPlayed) progressPlayed.style.width = "0%";
    if (currentTimeLabel) currentTimeLabel.textContent = "0:00";
    if (durationLabel) durationLabel.textContent = "0:00";
    setPlayPauseIcon(true);
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes)) return "";
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function renderFileInfo(file) {
    if (!fileInfo) return;
    if (!file) {
        fileInfo.classList.remove("active");
        fileInfo.innerHTML = "";
        return;
    }

    const sizeText = formatFileSize(file.size || 0);
    fileInfo.classList.add("active");
    fileInfo.innerHTML = `
        <div><strong>${file.name}</strong></div>
        <div>${sizeText}</div>
    `;
}

function handleFileSelection() {
    const file = fileInput?.files?.[0] || null;
    selectedFile = file;
    lastSavedEntry = null;
    renderFileInfo(file);
}

function clearFileSelection() {
    selectedFile = null;
    if (fileInput) {
        fileInput.value = "";
    }
    renderFileInfo(null);
}

function parseNumeric(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const cleaned = value.replace(/[^0-9+\-eE.]/g, "");
        const parsed = Number(cleaned);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function deriveConfidence(result) {
    const sources = [result.confidence, result.average_probability, result.averageProbability, result.probability, result.score];
    for (const source of sources) {
        const numeric = parseNumeric(source);
        if (numeric === null) continue;
        const percent = numeric <= 1 ? numeric * 100 : numeric;
        return Math.round(percent);
    }
    return null;
}

function deriveExplanation(result) {
    if (typeof result.explanation === "string" && result.explanation.trim()) {
        return result.explanation.trim();
    }
    if (Array.isArray(result.top_frames) && result.top_frames.length) {
        return "Highlighted frames show the areas the model found most indicative of manipulation.";
    }
    const numeric = parseNumeric(result.average_probability) ?? parseNumeric(result.probability);
    if (numeric !== null) {
        const percent = numeric <= 1 ? (numeric * 100).toFixed(1) : numeric.toFixed(1);
        return `Average model confidence: ${percent}%`;
    }
    return "The detector processed the file successfully but did not provide additional explanation.";
}

function applyLabelStyles(labelText) {
    const upper = labelText.toUpperCase();
    const isReal = upper === "REAL";
    const accent = isReal ? "#15803d" : "#d20b0b";
    const labelEl = document.querySelector(".big-fake");
    const percentEl = document.querySelector(".percent");
    if (labelEl) labelEl.style.color = accent;
    if (percentEl) percentEl.style.color = accent;
}

function applyResultToUI(result, file) {
    const labelText = (result.label || "UNKNOWN").toString().toUpperCase();
    const labelEl = document.querySelector(".big-fake");
    const percentEl = document.querySelector(".percent");
    const confidenceHeading = document.querySelector(".confidence");
    const notes = document.querySelector(".notes");

    if (labelEl) labelEl.textContent = labelText;

    const confidence = deriveConfidence(result);
    if (percentEl) percentEl.textContent = confidence === null ? "N/A" : `${confidence}%`;
    if (confidenceHeading) {
        confidenceHeading.textContent = confidence === null ? "Confidence Not Available" : "Confidence Level:";
    }
    if (notes) {
        notes.innerHTML = `
            <h4>Explanation</h4>
            <p>${deriveExplanation(result)}</p>
        `;
    }
    if (filenameLabel) filenameLabel.textContent = file.name;
    applyLabelStyles(labelText);
    renderHeatmap(result.top_frames);
}

function assignMediaSource(file) {
    if (!resultVideo) return;
    resetPlayerUI();

    if (currentMediaUrl) {
        URL.revokeObjectURL(currentMediaUrl);
        currentMediaUrl = null;
    }

    const objectUrl = URL.createObjectURL(file);
    currentMediaUrl = objectUrl;
    resultVideo.src = objectUrl;
    resultVideo.load();
}

function assignRemoteMediaSource(url) {
    if (!resultVideo) return;
    resetPlayerUI();
    if (currentMediaUrl) {
        URL.revokeObjectURL(currentMediaUrl);
        currentMediaUrl = null;
    }
    resultVideo.src = url;
    resultVideo.load();
}

if (playPauseBtn && resultVideo) {
    playPauseBtn.addEventListener("click", () => {
        if (resultVideo.paused) {
            resultVideo.play().catch(() => setPlayPauseIcon(true));
        } else {
            resultVideo.pause();
        }
    });
}

if (saveBtn) {
    saveBtn.addEventListener("click", async (event) => {
        event.preventDefault();

        if (lastSavedEntry?.url) {
            await showAlert("Saved", `${lastSavedEntry.name || "Your file"} is already stored in your history.`, "success");
            return;
        }

        if (selectedFile) {
            await showAlert("Pending upload", "Run the analysis first so the file is saved automatically.", "info");
            return;
        }

        await showAlert("Nothing to save", "Upload or open a file first.", "info");
    });
}

if (deleteBtn) {
    deleteBtn.addEventListener("click", async (event) => {
        event.preventDefault();

        if (!lastSavedEntry?.name) {
            await showAlert("Nothing to delete", "Open a saved file first.", "info");
            return;
        }

        const confirmation = await window.Swal.fire({
            title: "Delete this file?",
            text: `This will remove ${lastSavedEntry.name} from your library.`,
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Yes, delete it",
            cancelButtonText: "Cancel",
            confirmButtonColor: "#b91c1c",
            cancelButtonColor: "#6b7280",
        });

        if (!confirmation.isConfirmed) {
            return;
        }

        const user = await requireAuthenticatedUser();
        if (!user) {
            await showAlert("Authentication required", "Please log in first!", "warning");
            return;
        }

        try {
            showLoading("Deleting file...");
            await deleteFromStorageAndHistory(user.uid, lastSavedEntry);
            hideAlert();
            await showAlert("Deleted", `${lastSavedEntry.name} has been removed.`, "success");
            lastSavedEntry = null;
            clearFileSelection();
            resetPlayerUI();
            if (resultVideo) {
                resultVideo.removeAttribute("src");
                resultVideo.load();
            }
            currentMediaUrl = null;
            if (filenameLabel) {
                filenameLabel.textContent = "No file selected";
            }
            renderHeatmap(null);
            loadHistory();
            if (typeof window.showUploadPage === "function") {
                window.showUploadPage();
            }
        } catch (error) {
            hideAlert();
            await showAlert("Delete failed", error.message || "Unable to delete this file.", "error");
        }
    });
}

if (heatmapGallery) {
    heatmapGallery.addEventListener("click", (event) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target) return;
        const thumb = target.closest(".heatmap-thumb");
        if (!(thumb instanceof HTMLElement)) return;
        const index = Number(thumb.dataset.index);
        if (!Number.isFinite(index)) return;
        lastHeatmapTrigger = thumb;
        openHeatmapModal(index);
    });

    heatmapGallery.addEventListener("keydown", (event) => {
        if (!["Enter", " ", "Space", "Spacebar"].includes(event.key)) return;
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target) return;
        const thumb = target.closest(".heatmap-thumb");
        if (!(thumb instanceof HTMLElement)) return;
        const index = Number(thumb.dataset.index);
        if (!Number.isFinite(index)) return;
        event.preventDefault();
        lastHeatmapTrigger = thumb;
        openHeatmapModal(index);
    });
}

if (heatmapModalClose) {
    heatmapModalClose.addEventListener("click", () => closeHeatmapModal());
}

if (heatmapModalBackdrop) {
    heatmapModalBackdrop.addEventListener("click", () => closeHeatmapModal());
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && heatmapModal?.classList.contains("visible")) {
        closeHeatmapModal();
    }
});

if (rewindBtn && resultVideo) {
    rewindBtn.addEventListener("click", () => {
        resultVideo.currentTime = Math.max(0, resultVideo.currentTime - SEEK_INTERVAL);
    });
}

if (forwardBtn && resultVideo) {
    forwardBtn.addEventListener("click", () => {
        const duration = Number.isFinite(resultVideo.duration) ? resultVideo.duration : resultVideo.currentTime + SEEK_INTERVAL;
        resultVideo.currentTime = Math.min(duration, resultVideo.currentTime + SEEK_INTERVAL);
    });
}

if (resultVideo) {
    resultVideo.addEventListener("loadedmetadata", () => {
        updateProgressUI();
        setPlayPauseIcon(resultVideo.paused);
    });
    resultVideo.addEventListener("timeupdate", updateProgressUI);
    resultVideo.addEventListener("play", () => setPlayPauseIcon(false));
    resultVideo.addEventListener("pause", () => setPlayPauseIcon(true));
    resultVideo.addEventListener("ended", () => {
        resultVideo.currentTime = resultVideo.duration || 0;
        updateProgressUI();
        setPlayPauseIcon(true);
    });
}

if (playPauseIcon) {
    resetPlayerUI();
}

// --------------------
// Upload file to Firebase Storage and save metadata
// --------------------
async function uploadFileToStorage(file) {
    const user = await requireAuthenticatedUser();
    if (!user) {
        showAlert("Authentication required", "Please log in first!", "warning");
        return;
    }

    const storageRef = ref(storage, `uploads/${user.uid}/${file.name}`);
    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);

    // Save metadata in Firestore
    const docRef = await addDoc(collection(db, "uploads"), {
        fileName: file.name,
        fileUrl: downloadURL,
        uploadedAt: new Date(),
        userId: user.uid,
        heatmaps: [],
        analysisType: file.name.split(".").pop()?.toLowerCase() || "unknown"
    });

    loadHistory();

    return { url: downloadURL, docId: docRef.id };
}

async function persistHeatmaps(docId, frames) {
    if (!docId || !Array.isArray(frames) || frames.length === 0) {
        return;
    }

    try {
        const safeFrames = frames.slice(0, 6);
        await updateDoc(doc(db, "uploads", docId), {
            heatmaps: safeFrames,
            heatmapsUpdatedAt: new Date()
        });
    } catch (error) {
        console.warn("Unable to persist heatmaps", error);
    }
}

function renderHeatmap(frames) {
    if (!heatmapGallery) return;
    if (heatmapModal?.classList.contains("visible")) {
        closeHeatmapModal();
    }
    if (!Array.isArray(frames) || frames.length === 0) {
        currentHeatmaps = [];
        heatmapGallery.innerHTML = '<div class="heatmap-empty">No heatmap highlights for this file.</div>';
        return;
    }

    currentHeatmaps = frames.slice(0, 6);
    const items = currentHeatmaps.map((frame, index) => {
        const safeIndex = index + 1;
        return `
            <div class="heatmap-thumb" data-index="${index}" role="button" tabindex="0" aria-label="View highlighted frame ${safeIndex}">
                <img src="data:image/png;base64,${frame}" alt="Highlighted frame ${safeIndex}">
                <span>#${safeIndex}</span>
            </div>
        `;
    });
    heatmapGallery.innerHTML = items.join("");
}

function openHeatmapModal(index) {
    if (!heatmapModal || !heatmapModalImage) return;
    if (!Array.isArray(currentHeatmaps) || !currentHeatmaps[index]) return;

    activeHeatmapIndex = index;
    heatmapModalImage.src = `data:image/png;base64,${currentHeatmaps[index]}`;
    heatmapModalImage.alt = `Highlighted frame ${index + 1}`;
    heatmapModal.classList.add("visible");
    heatmapModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    if (heatmapModalClose) {
        heatmapModalClose.focus();
    }
}

function closeHeatmapModal() {
    if (!heatmapModal) return;
    heatmapModal.classList.remove("visible");
    heatmapModal.setAttribute("aria-hidden", "true");
    if (heatmapModalImage) {
        heatmapModalImage.removeAttribute("src");
        heatmapModalImage.alt = "Highlighted frame preview";
    }
    document.body.classList.remove("modal-open");
    activeHeatmapIndex = -1;
    if (lastHeatmapTrigger instanceof HTMLElement) {
        lastHeatmapTrigger.focus();
    }
    lastHeatmapTrigger = null;
}

async function deleteFromStorageAndHistory(userId, entry) {
    const fileName = entry?.name;
    const storageRef = fileName ? ref(storage, `uploads/${userId}/${fileName}`) : null;
    try {
        if (storageRef) {
            await deleteObject(storageRef);
        }
    } catch (error) {
        if (error?.code !== "storage/object-not-found") {
            throw error;
        }
    }

    if (entry?.docId) {
        await deleteDoc(doc(db, "uploads", entry.docId));
    } else if (fileName) {
        const q = query(
            collection(db, "uploads"),
            where("userId", "==", userId),
            where("fileName", "==", fileName)
        );
        const snapshot = await getDocs(q);
        const deletions = snapshot.docs.map((docSnap) => deleteDoc(docSnap.ref));
        await Promise.all(deletions);
    }
}

async function sendToBackend(file) {
    const formData = new FormData();
    formData.append("file", file);

    // Decide endpoint based on file extension
    const ext = file.name.split(".").pop().toLowerCase();
    const endpoint = ["mp4", "mov", "avi"].includes(ext)
        ? "/predict/video"
        : "/predict/audio";

    const response = await fetch(BACKEND_URL + endpoint, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "API error");
    }

    return response.json();
}

// --------------------
// Continue button: upload + backend detect + show result
// --------------------
continueBtn.addEventListener("click", async () => {
    const file = selectedFile;
    if (!file) {
        showAlert("No file selected", "Add a file to the dropzone first!", "warning");
        return;
    }

    const guest = typeof isGuestMode === "function" && isGuestMode();

    try {
        if (guest) {
            showLoading("Analyzing file...");
            lastSavedEntry = null;
        } else {
            showLoading("Uploading file...");
            // Upload to Firebase
            const storageResult = await uploadFileToStorage(file);
            if (!storageResult) {
                hideAlert();
                return;
            }
            lastSavedEntry = { name: file.name, url: storageResult.url, docId: storageResult.docId };
            updateLoading("Analyzing file...");
        }

        // Send to Python backend
        const result = await sendToBackend(file);

        console.log("Backend Result:", result);

        applyResultToUI(result, file);
        assignMediaSource(file);

        if (!guest && lastSavedEntry?.docId) {
            const frames = Array.isArray(result.top_frames) ? result.top_frames : [];
            if (frames.length) {
                lastSavedEntry.heatmaps = frames;
                await persistHeatmaps(lastSavedEntry.docId, frames);
            } else {
                lastSavedEntry.heatmaps = null;
            }
        }

        hideAlert();
        // Show Result Page
        window.showResultPage();
        clearFileSelection();


    } catch (err) {
        hideAlert();
        showAlert("Processing error", err.message, "error");
        console.error(err);
    }
});

// --------------------
// Load file history for current user
// --------------------
export async function loadHistory() {
    const user = await requireAuthenticatedUser();
    if (!user) {
        const guest = typeof isGuestMode === "function" && isGuestMode();
        fileSection.innerHTML = guest
            ? "<p>Guest uploads are analyzed but not saved.</p>"
            : "<p>Please login to see your files.</p>";
        return;
    }

    const q = query(
        collection(db, "uploads"),
        where("userId", "==", user.uid),
        orderBy("uploadedAt", "desc")
    );
    const snapshot = await getDocs(q);
    const files = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

    // Group by Today / Yesterday / Older
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    let html = "";
    const groups = { "Today": [], "Yesterday": [], "Older": [] };

    files.forEach(f => {
        const d = f.uploadedAt.toDate ? f.uploadedAt.toDate() : new Date(f.uploadedAt);
        const dStr = d.toLocaleString();

        if (d.toDateString() === today.toDateString()) groups["Today"].push({ ...f, displayDate: dStr });
        else if (d.toDateString() === yesterday.toDateString()) groups["Yesterday"].push({ ...f, displayDate: dStr });
        else groups["Older"].push({ ...f, displayDate: dStr });
    });

    for (const [group, items] of Object.entries(groups)) {
        if (!items.length) continue;
        html += `<h4>${group}</h4>`;
        items.forEach(f => {
            html += `<div class="file-item" onclick="openSavedFile('${f.id}')">
                        📄 ${f.fileName} <br>
                        <small>${f.displayDate}</small>
                     </div>`;
        });
    }

    if (!html) html = "<p>No files uploaded yet.</p>";
    fileSection.innerHTML = html;
}

// --------------------
// Open saved file by fileName
// --------------------
window.openSavedFile = async function(docId) {
    const user = await requireAuthenticatedUser();
    if (!user) {
        showAlert("Authentication required", "Please log in first!", "warning");
        return;
    }

    if (!docId) {
        showAlert("Not found", "File not found.", "info");
        return;
    }

    const recordRef = doc(db, "uploads", docId);
    const docSnap = await getDoc(recordRef);
    if (!docSnap.exists()) {
        showAlert("Not found", "File not found.", "info");
        return;
    }

    const file = docSnap.data();
    if (file.userId !== user.uid) {
        showAlert("Access denied", "You do not have permission to view this file.", "warning");
        return;
    }

    if (filenameLabel && file.fileName) {
        filenameLabel.textContent = file.fileName;
    }
    lastSavedEntry = {
        name: file.fileName,
        url: file.fileUrl,
        docId,
        heatmaps: Array.isArray(file.heatmaps) ? file.heatmaps : null
    };
    assignRemoteMediaSource(file.fileUrl);
    renderHeatmap(Array.isArray(file.heatmaps) ? file.heatmaps : null);
    clearFileSelection();
    window.showResultPage();
};

// --------------------
// Load history when user logs in
// --------------------
auth.onAuthStateChanged(user => {
    if (user) loadHistory();
});
