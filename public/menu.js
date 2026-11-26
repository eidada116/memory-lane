const socket = io();

const $ = (id) => document.getElementById(id);

const home = $("home");
const lobby = $("lobby");
const studio = $("studio");
const result = $("result");

const cam = $("cam");
const videos = $("videos");
const studioPhotos = $("studioPhotos");
const studioCountdown = $("studioCountdown");
const finalCanvas = $("finalCanvas");

let currentTheme = "hanging";
const tilts = [-6, 4, -3, 7];

// ---------- switching screens ----------

function showHome() {
    home.hidden = false;
    lobby.hidden = true;
    studio.hidden = true;
    result.hidden = true;

    stopCamera();
    document.body.classList.remove("lobby-active", "studio-active", "result-active", "strip-result");
}

function showLobby() {
    home.hidden = true;
    lobby.hidden = false;
    studio.hidden = true;
    result.hidden = true;

    stopCamera();
    document.body.classList.add("lobby-active");
    document.body.classList.remove("studio-active", "result-active", "strip-result");
}

function showStudio() {
    home.hidden = true;
    lobby.hidden = true;
    studio.hidden = false;
    result.hidden = true;

    document.body.classList.remove("lobby-active", "result-active");
    document.body.classList.add("studio-active");
    document.body.classList.toggle("strip-result", currentTheme === "strip");
}

function showResult() {
    home.hidden = true;
    lobby.hidden = true;
    studio.hidden = true;
    result.hidden = false;

    stopCamera();
    document.body.classList.remove("lobby-active", "studio-active");
    document.body.classList.add("result-active");
    document.body.classList.toggle("strip-result", currentTheme === "strip");
}

// ---------- live strip / hanging slots ----------

function buildStudioLayout(theme) {
    if (cam.parentElement !== videos) {
        videos.appendChild(cam);
    }
    Object.values(remoteVideos).forEach((v) => {
        if (v.parentElement !== videos) {
            videos.appendChild(v);
        }
    });

    studioPhotos.innerHTML = "";
    studioPhotos.className = theme === "strip" ? "strip-mode" : "hanging-mode";

    for (let i = 0; i < 4; i++) {
        const slot = document.createElement("div");
        slot.className = "studio-slot";
        slot.id = `studio-slot-${i}`;

        if (theme === "hanging") {
            slot.style.transform = `rotate(${tilts[i]}deg)`;
        }

        const placeholder = document.createElement("span");
        placeholder.className = "slot-waiting";
        placeholder.textContent = i === 0 ? "Starting your camera..." : "Waiting for friend...";
        slot.appendChild(placeholder);

        studioPhotos.appendChild(slot);
    }

    syncAllVideosToSlots();
}

function syncAllVideosToSlots() {
    // first slot is my cam
    const slot0 = $("studio-slot-0");
    if (slot0) {
        if (localStream) {
            if (cam.srcObject !== localStream) {
                cam.srcObject = localStream;
            }
            if (cam.parentElement !== slot0) {
                slot0.innerHTML = "";
                slot0.appendChild(cam);
            }
            cam.play().catch(() => {});
        } else {
            if (cam.parentElement === slot0) {
                videos.appendChild(cam);
            }
            slot0.innerHTML = `<span class="slot-waiting">Starting your camera...</span>`;
        }
    }

    // rest of the slots for friends with active feeds
    const activePeerIds = Object.keys(remoteVideos).filter((id) => {
        const v = remoteVideos[id];
        const stream = v && v.srcObject;
        if (!stream) return false;
        const tracks = stream.getVideoTracks();
        return tracks.length > 0 && tracks.some((t) => t.readyState === "live" && !t.muted);
    });

    for (let i = 1; i < 4; i++) {
        const slot = $(`studio-slot-${i}`);
        if (!slot) continue;

        const peerId = activePeerIds[i - 1];
        const v = peerId ? remoteVideos[peerId] : null;

        if (v) {
            if (v.parentElement !== slot) {
                slot.innerHTML = "";
                slot.appendChild(v);
            }
            v.play().catch(() => {});
        } else {
            Object.values(remoteVideos).forEach((rv) => {
                if (rv.parentElement === slot) {
                    videos.appendChild(rv);
                }
            });
            slot.innerHTML = `<span class="slot-waiting">Waiting for friend...</span>`;
        }
    }
}

// ---------- cam (only turn on in studio) ----------

let localStream = null;
let camPromise = null;

async function startCamera() {
    if (localStream) {
        syncAllVideosToSlots();
        return localStream;
    }

    if (!camPromise) {
        camPromise = navigator.mediaDevices
            .getUserMedia({ video: { facingMode: "user", width: 400, height: 300 }, audio: false })
            .then(async (stream) => {
                localStream = stream;
                cam.srcObject = stream;
                syncAllVideosToSlots();
                await cam.play().catch(() => {});

                // send cam track to peers that connected before cam turned on
                for (const [id, pc] of Object.entries(peers)) {
                    const videoSender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
                    const track = stream.getVideoTracks()[0];
                    if (videoSender && track) {
                        await videoSender.replaceTrack(track);
                    } else if (track) {
                        pc.addTrack(track, stream);
                    }

                    if (pc.signalingState === "stable") {
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        socket.emit("signal", {
                            to: id,
                            data: { sdp: pc.localDescription }
                        });
                    }
                }

                return stream;
            })
            .catch((error) => {
                console.error("Camera error:", error);
                $("camError").textContent = "Unable to access your camera.";
                camPromise = null;
                return null;
            });
    }

    return camPromise;
}

function stopCamera() {
    if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        localStream = null;
    }
    camPromise = null;
    cam.srcObject = null;

    if (cam.parentElement !== videos) {
        videos.appendChild(cam);
    }
}

// ---------- rooms ----------

$("createBtn").onclick = () => {
    $("error").textContent = "";
    socket.emit("create-room");
};

$("joinBtn").onclick = () => {
    const code = $("codeInput").value.trim().toUpperCase();

    if (!code) {
        $("error").textContent = "Please enter a room code!";
        return;
    }

    $("error").textContent = "";
    socket.emit("join-room", code);
};

socket.on("joined", ({ code, count }) => {
    showLobby();

    $("error").textContent = "";
    $("roomCode").textContent = code;
    $("count").textContent = count;

    renderParticipants(count);

    $("startBtn").disabled = count < 4;
});

socket.on("error-msg", (msg) => {
    showHome();
    $("error").textContent = msg;
});

$("backBtn").onclick = () => {
    stopCamera();
    window.location.reload();
};

// ---------- webrtc stuff ----------

const peers = {};
const remoteVideos = {};

const config = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
    ]
};

function makePeer(id) {
    if (peers[id]) return peers[id];

    const pc = new RTCPeerConnection(config);
    peers[id] = pc;

    if (localStream) {
        localStream.getTracks().forEach((t) => {
            pc.addTrack(t, localStream);
        });
    }

    pc.onicecandidate = (e) => {
        if (e.candidate) {
            socket.emit("signal", {
                to: id,
                data: { candidate: e.candidate }
            });
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
            if (remoteVideos[id]) {
                remoteVideos[id].remove();
                delete remoteVideos[id];
            }
            syncAllVideosToSlots();
        }
    };

    pc.ontrack = (e) => {
        let v = remoteVideos[id];

        if (!v) {
            v = document.createElement("video");
            v.id = "v-" + id;
            v.autoplay = true;
            v.playsInline = true;
            remoteVideos[id] = v;
        }

        const stream = e.streams[0] || new MediaStream([e.track]);
        v.srcObject = stream;

        e.track.onunmute = () => syncAllVideosToSlots();
        e.track.onmute = () => syncAllVideosToSlots();
        e.track.onended = () => syncAllVideosToSlots();

        syncAllVideosToSlots();
    };

    return pc;
}

socket.on("peers", async (ids) => {
    for (const id of ids) {
        const pc = makePeer(id);
        if (pc.signalingState !== "stable") continue;

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket.emit("signal", {
            to: id,
            data: { sdp: pc.localDescription }
        });
    }
});

socket.on("signal", async ({ from, data }) => {
    const pc = peers[from] || makePeer(from);

    if (data.sdp) {
        const desc = data.sdp;

        if (desc.type === "offer") {
            // skip if we already sent an offer and are waiting on it
            if (pc.signalingState !== "stable") {
                return;
            }

            await pc.setRemoteDescription(desc);

            if (localStream) {
                const track = localStream.getVideoTracks()[0];
                const videoSender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
                if (videoSender && track) {
                    await videoSender.replaceTrack(track);
                } else if (track) {
                    pc.addTrack(track, localStream);
                }
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            socket.emit("signal", {
                to: from,
                data: { sdp: pc.localDescription }
            });
        } else if (desc.type === "answer" && pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(desc);
        }
    } else if (data.candidate) {
        try {
            await pc.addIceCandidate(data.candidate);
        } catch (err) {
            console.warn("ICE candidate error:", err);
        }
    }
});

socket.on("peer-left", (id) => {
    if (peers[id]) {
        peers[id].close();
    }
    delete peers[id];

    const v = remoteVideos[id];
    if (v) {
        v.remove();
        delete remoteVideos[id];
    }

    syncAllVideosToSlots();
});

// ---------- theme ----------

$("hangingBtn").onclick = () => {
    socket.emit("pick-theme", "hanging");
};

$("stripBtn").onclick = () => {
    socket.emit("pick-theme", "strip");
};

socket.on("theme", (t) => {
    currentTheme = t;
    $("themeName").textContent = t === "strip" ? "Photo Strip" : "Hanging Photo";
});
// ---------- countdown + snap in studio ----------

async function enterStudio() {
    if (studio.hidden) {
        studioCountdown.textContent = "";
        showStudio();
        buildStudioLayout(currentTheme);
    }
    await startCamera();
    syncAllVideosToSlots();
}

$("startBtn").onclick = async () => {
    await enterStudio();
    socket.emit("start");
};

socket.on("tick", async (n) => {
    await enterStudio();
    studioCountdown.textContent = n;
});

socket.on("capture", async () => {
    await enterStudio();
    studioCountdown.textContent = "📸";

    const c = document.createElement("canvas");
    c.width = 400;
    c.height = 300;

    const ctx = c.getContext("2d");
    ctx.translate(400, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(cam, 0, 0, 400, 300);

    socket.emit("photo", c.toDataURL("image/jpeg", 0.8));
});

// ---------- results ----------

function loadImg(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image failed to load"));
        img.src = src;
    });
}

function drawCoverImage(ctx, img, dx, dy, dWidth, dHeight) {
    const imgRatio = img.width / img.height;
    const boxRatio = dWidth / dHeight;

    let sx = 0;
    let sy = 0;
    let sWidth = img.width;
    let sHeight = img.height;

    if (imgRatio > boxRatio) {
        // wider than slot -> crop left & right
        sWidth = img.height * boxRatio;
        sx = (img.width - sWidth) / 2;
    } else if (imgRatio < boxRatio) {
        // taller than slot -> crop top & bottom
        sHeight = img.width / boxRatio;
        sy = (img.height - sHeight) / 2;
    }

    ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
}

async function drawResult(srcs) {
    const imgs = await Promise.all(srcs.map(loadImg));
    const ctx = finalCanvas.getContext("2d");

    if (currentTheme === "strip") {
        finalCanvas.width = 360;
        finalCanvas.height = 1040;

        ctx.fillStyle = "#fff7ee";
        ctx.fillRect(0, 0, 360, 1040);

        imgs.forEach((img, i) => {
            const x = 10;
            const y = 20 + i * 250;

            ctx.fillStyle = "#ffffff";
            ctx.fillRect(x, y, 340, 230);

            drawCoverImage(ctx, img, x + 10, y + 10, 320, 210);
        });
    } else {
        finalCanvas.width = 760;
        finalCanvas.height = 620;

        ctx.fillStyle = "#fffced";
        ctx.fillRect(0, 0, 760, 620);

        imgs.forEach((img, i) => {
            const x = 190 + (i % 2) * 380;
            const y = 170 + Math.floor(i / 2) * 270;

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate((tilts[i] * Math.PI) / 180);

            ctx.fillStyle = "#ffffff";
            ctx.fillRect(-150, -115, 300, 230);

            drawCoverImage(ctx, img, -140, -105, 280, 210);

            ctx.fillStyle = "#f4a6b0";
            ctx.beginPath();
            ctx.arc(0, -115, 7, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
        });
    }
}

socket.on("photos", async (srcs) => {
    await drawResult(srcs);
    showResult();
});

$("downloadBtn").onclick = () => {
    const a = document.createElement("a");
    a.href = finalCanvas.toDataURL("image/png");
    a.download = "memory-lane.png";
    a.click();
};

// ---------- retake ----------

$("retakeBtn").onclick = () => {
    socket.emit("retake");
};

socket.on("retake", () => {
    studioCountdown.textContent = "";
    studioPhotos.innerHTML = "";
    showLobby();
});

// ---------- little avatars ----------

function renderParticipants(count) {
    const container = $("participants");
    container.innerHTML = "";

    for (let i = 1; i <= Math.min(count, 4); i++) {
        const img = document.createElement("img");
        img.src = `./assets/p${i}.png`;
        img.alt = `Participant ${i}`;
        img.classList.add("participant-photo");
        container.appendChild(img);
        img.style.border= "3px solid #92694d";
    }
}

