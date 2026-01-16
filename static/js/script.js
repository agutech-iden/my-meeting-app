let room;
let isHost = false;
let isRecording = false;
let handRaised = false;
let screenSharingActive = false;
let screenSharingOwner = null;

const chatNotify = new Audio('/static/notify.mp3');
const handNotify = new Audio('/static/hand.mp3');
let audioUnlocked = false;

function unlockAudioOnce() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    [chatNotify, handNotify].forEach(a => {
        a.muted = true;
        const p = a.play();
        if (p) p.catch(() => {}).finally(() => {
            a.pause();
            a.currentTime = 0;
            a.muted = false;
        });
    });
}

document.addEventListener('click', unlockAudioOnce, { once: true });
document.addEventListener('keydown', unlockAudioOnce, { once: true });

function showTab(type) {
    document.getElementById('host-tab').style.display = type === 'host' ? 'block' : 'none';
    document.getElementById('join-tab').style.display = type === 'join' ? 'block' : 'none';
    document.getElementById('btn-h').classList.toggle('active', type === 'host');
    document.getElementById('btn-j').classList.toggle('active', type === 'join');
}

function showError(message, isFatal = false) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.innerHTML = `<strong>Error:</strong> ${message}`;

    const dashboard = document.getElementById('dashboard-screen');
    if (dashboard) {
        dashboard.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 5000);
    }

    if (isFatal) {
        setTimeout(() => location.reload(), 3000);
    }
}

async function startMeeting(asHost) {
    isHost = asHost;

    const user = document.getElementById('username').value;
    const title = document.getElementById('m-title').value;
    if (!user || !title) return alert("Enter Name and Title");

    const btn = document.querySelector('.host-btn');
    const originalText = btn.innerText;
    btn.innerText = "Starting...";
    btn.disabled = true;

    try {
        const res = await fetch('/create_meeting', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user, title, start: "now", end: "later" })
        });

        if (!res.ok) throw new Error('Failed to create meeting');

        const data = await res.json();
        await handleJoin(user, data.code, true, title);
    } catch (e) {
        showError(e.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

async function joinMeeting() {
    isHost = false;

    const user = document.getElementById('username').value;
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (!user || !code) return alert("Enter Name and Code!");

    const btn = document.querySelector('.join-btn');
    const originalText = btn.innerText;
    btn.innerText = "Joining...";
    btn.disabled = true;

    try {
        await handleJoin(user, code, false, "");
    } catch (e) {
        showError(e.message);
        btn.innerText = originalText;
        btn.disabled = false;
    }
}

function applyRolePermissions(roomCode, meetingTitle) {
    const display = document.getElementById('display-code');
    const copyBtn = document.getElementById('copy-btn');

    if (!display) return;

    if (!isHost) {
        if (display) {
            display.innerText = meetingTitle ? `Meeting: ${meetingTitle}` : "Meeting";
            display.style.fontWeight = "bold";
        }

        if (copyBtn) copyBtn.remove();
        const recBtn = document.getElementById('rec-btn');
        if (recBtn) recBtn.remove();
        const hostMuteBtn = document.getElementById('host-mute-btn');
        if (hostMuteBtn) hostMuteBtn.remove();
    } else {
        if (display) {
            display.innerText = `Hosting: ${roomCode}`;
            display.style.fontWeight = "normal";
        }

        const muteAllBtn = document.getElementById('host-mute-btn');
        if (muteAllBtn) muteAllBtn.style.display = "inline-block";
    }
}

function togglePanel(id) {
    const p = document.getElementById(id);
    if (p.style.display === 'flex' || p.style.display === '') {
        p.style.display = 'none';
    } else {
        p.style.display = 'flex';
    }

    if (id === 'participant-panel') {
        updateParticipantList();
    }
}

function updateLayoutSoloMode() {
    const grid = document.getElementById('video-grid');
    if (!grid || !room) return;

    // Get all video containers
    const videoContainers = document.querySelectorAll('.video-container');
    const totalVideos = videoContainers.length;

    // Update participant count in panel header
    const panelHeader = document.querySelector('#participant-panel .panel-header span');
    if (panelHeader) {
        panelHeader.textContent = `Participants (${totalVideos})`;
    }

    // Solo mode: Only one video container
    if (totalVideos <= 1) {
        grid.classList.add('solo');
    } else {
        grid.classList.remove('solo');
    }
}

function updateParticipantList() {
    if (!room) return;

    const list = document.getElementById('participant-list');
    if (!list) return;

    list.innerHTML = "";

    // Add local participant
    if (room.localParticipant) {
        const local = room.localParticipant;
        list.innerHTML += `<div class="p-row"><strong>${local.identity} (Me) ${isHost ? "(Host)" : ""}</strong></div>`;
    }

    // Add remote participants
    if (room.remoteParticipants && room.remoteParticipants.size > 0) {
        room.remoteParticipants.forEach((p) => {
            list.innerHTML += `<div class="p-row">${p.identity}</div>`;
        });
    }

    updateLayoutSoloMode();
}

function createVideoContainer(identity, isLocal = false) {
    let cont = document.getElementById(`cont-${identity}`);
    if (!cont) {
        cont = document.createElement('div');
        cont.className = "video-container";
        cont.id = `cont-${identity}`;

        const initials = identity.substring(0, 2).toUpperCase();
        cont.innerHTML = `
            <div class="hand-badge" id="hand-${identity}">✋</div>
            <div class="video-placeholder" id="placeholder-${identity}">
                <div class="initials-circle">${initials}</div>
                <span>${identity}${isLocal ? " (Me)" : ""}${isLocal && isHost ? " (Host)" : ""}</span>
            </div>
        `;
        document.getElementById('video-grid').appendChild(cont);
        updateLayoutSoloMode();
    }
    return cont;
}

function attachVideoSafely(track, identity, elementId, muteIt = false) {
    try {
        const el = track.attach();
        el.id = elementId;

        el.autoplay = true;
        el.playsInline = true;
        el.muted = muteIt;
        el.setAttribute("playsinline", "true");
        el.setAttribute("webkit-playsinline", "true");
        el.crossOrigin = "anonymous";

        el.style.objectFit = "cover";
        el.style.width = "100%";
        el.style.height = "100%";
        el.style.backgroundColor = "#000";

        const playPromise = el.play();
        if (playPromise !== undefined) {
            playPromise.catch(err => {
                el.muted = true;
                el.play().catch(e => console.warn("Muted playback failed:", e));
            });
        }

        return el;
    } catch (error) {
        console.error("Error attaching video:", error);
        return null;
    }
}

function showHandOnVideo(userId, raised) {
    const badge = document.getElementById(`hand-${userId}`);
    if (badge) {
        badge.style.display = raised ? "block" : "none";
    }
}

async function handleJoin(username, roomCode, asHostFlag, meetingTitle) {
    try {
        isHost = asHostFlag;

        const response = await fetch('/get_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: roomCode, user: username, isHost: isHost })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        if (!data.token) {
            throw new Error("No token received from server");
        }

        // Initialize LiveKit Room
        room = new LivekitClient.Room({
            adaptiveStream: true,
            dynacast: true
        });

        // Setup event handlers
        setupRoomEventHandlers();

        // Connect to LiveKit
        await room.connect('wss://agutech-mini-zoom-dtc5dowj.livekit.cloud', data.token);

        // Switch UI to meeting room
        document.getElementById('dashboard-screen').style.display = 'none';
        document.getElementById('meeting-room').style.display = 'flex';

        applyRolePermissions(roomCode, meetingTitle);

        // Enable local media
        try {
            await room.localParticipant.setCameraEnabled(true);
            await room.localParticipant.setMicrophoneEnabled(true);

            // Create local video container
            const localIdentity = room.localParticipant.identity;
            createVideoContainer(localIdentity, true);

            // Setup local video with delay
            setTimeout(() => setupLocalVideo(), 1000);

        } catch (mediaError) {
            console.warn("Media permission error:", mediaError);
            showError("Camera/mic permission needed. Please allow access.", false);
            if (room.localParticipant) {
                const localIdentity = room.localParticipant.identity;
                createVideoContainer(localIdentity, true);
            }
        }

        // Initial updates
        updateParticipantList();
        updateLayoutSoloMode();

        // Re-enable buttons
        document.querySelector('.host-btn')?.removeAttribute('disabled');
        document.querySelector('.join-btn')?.removeAttribute('disabled');

    } catch (e) {
        console.error("Join error:", e);
        showError("Error joining: " + e.message, false);

        document.getElementById('dashboard-screen').style.display = 'block';
        document.getElementById('meeting-room').style.display = 'none';

        const hostBtn = document.querySelector('.host-btn');
        const joinBtn = document.querySelector('.join-btn');
        if (hostBtn) {
            hostBtn.innerText = "Start Meeting";
            hostBtn.disabled = false;
        }
        if (joinBtn) {
            joinBtn.innerText = "Join Now";
            joinBtn.disabled = false;
        }

        if (room) {
            try {
                room.disconnect();
            } catch (disconnectError) {}
            room = null;
        }
    }
}

function setupRoomEventHandlers() {
    if (!room) return;

    // Track subscribed
    room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, pub, participant) => {
        const isScreen = track.source === LivekitClient.Track.Source.ScreenShare;
        const isLocal = participant.identity === room.localParticipant?.identity;

        if (isScreen) {
            // Handle screen sharing
            handleScreenShare(track, participant);
        } else if (track.kind === "video") {
            // Handle regular video
            handleVideoTrack(track, participant, isLocal);
        }

        updateParticipantList();
        updateLayoutSoloMode();
    });

    // Track published
    room.on(LivekitClient.RoomEvent.TrackPublished, (pub, participant) => {
        if (participant.identity === room.localParticipant?.identity && pub.kind === "video") {
            setTimeout(() => {
                const localIdentity = room.localParticipant.identity;
                const placeholder = document.getElementById(`placeholder-${localIdentity}`);
                if (placeholder) placeholder.style.display = 'none';

                if (!document.getElementById(`local-${localIdentity}`) && pub.track) {
                    const el = pub.track.attach();
                    el.id = `local-${localIdentity}`;
                    el.autoplay = true;
                    el.playsInline = true;
                    el.muted = true;
                    el.style.objectFit = "cover";
                    el.style.width = "100%";
                    el.style.height = "100%";

                    const cont = document.getElementById(`cont-${localIdentity}`);
                    if (cont) {
                        cont.appendChild(el);
                        el.play().catch(e => console.warn("Local video play error:", e));
                    }
                }
            }, 500);
        }
    });

    // Track unsubscribed
    room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
        if (track.source === LivekitClient.Track.Source.ScreenShare) {
            document.getElementById('main-area').classList.remove('sharing-active');
            const pres = document.getElementById('presentation-area');
            pres.innerHTML = "";
            screenSharingActive = false;
            screenSharingOwner = null;

            if (participant.identity === room.localParticipant?.identity) {
                document.getElementById('share-btn').innerText = "Share";
            }
        } else if (track.kind === "video") {
            const placeholder = document.getElementById(`placeholder-${participant.identity}`);
            if (placeholder) placeholder.style.display = 'flex';
            const el = document.getElementById(`track-${participant.identity}`);
            if (el) el.remove();
        }

        updateParticipantList();
        updateLayoutSoloMode();
    });

    // Data received
    room.on(LivekitClient.RoomEvent.DataReceived, (payload, participant) => {
        const decoded = new TextDecoder().decode(payload);
        let msgData;
        try {
            msgData = JSON.parse(decoded);
        } catch (e) {
            return;
        }

        if (msgData.type === "chat") {
            appendMsg(participant.identity, msgData.msg);
            unlockAudioOnce();
            chatNotify.play().catch(() => {});
        }

        if (msgData.type === "hand_toggle") {
            showHandOnVideo(participant.identity, msgData.raised);
            if (msgData.raised) {
                unlockAudioOnce();
                handNotify.play().catch(() => {});
                appendMsg("System", `${participant.identity} raised their hand.`, true);
            }
        }

        if (msgData.type === "file") {
            appendFileMsg(participant.identity, msgData.fileName, msgData.fileData);
            unlockAudioOnce();
            chatNotify.play().catch(() => {});
        }

        if (msgData.type === "host_sharing" && !isHost) {
            if (room.localParticipant.isScreenShareEnabled) {
                room.localParticipant.setScreenShareEnabled(false);
                alert("Host started sharing. Your screen share has been stopped.");
            }
        }

        if (msgData.type === "rec_sync") {
            document.getElementById('rec-status').style.display = msgData.status ? "flex" : "none";
        }

        if (msgData.type === "mute_all" && !isHost) {
            room.localParticipant.setMicrophoneEnabled(false);
            document.getElementById('mic-btn').innerText = "Unmute";
            appendMsg("System", "Host has muted everyone.");
        }

        if (msgData.type === "screen_share_control") {
            if (msgData.action === "start") {
                screenSharingOwner = msgData.sharer;
                screenSharingActive = true;
            } else if (msgData.action === "stop") {
                if (msgData.sharer === screenSharingOwner) {
                    screenSharingActive = false;
                    screenSharingOwner = null;
                }
            }
        }
    });

    // Participant connected
    room.on(LivekitClient.RoomEvent.ParticipantConnected, (participant) => {
        console.log("Participant connected:", participant.identity);
        updateParticipantList();
        updateLayoutSoloMode();
    });

    // Participant disconnected
    room.on(LivekitClient.RoomEvent.ParticipantDisconnected, (p) => {
        const cont = document.getElementById(`cont-${p.identity}`);
        if (cont) cont.remove();

        if (p.identity === screenSharingOwner) {
            screenSharingActive = false;
            screenSharingOwner = null;
            document.getElementById('main-area').classList.remove('sharing-active');
            const pres = document.getElementById('presentation-area');
            pres.innerHTML = "";
        }

        updateParticipantList();
        updateLayoutSoloMode();
    });
}

function handleScreenShare(track, participant) {
    document.getElementById('main-area').classList.add('sharing-active');
    const pres = document.getElementById('presentation-area');
    pres.innerHTML = "";

    screenSharingActive = true;
    screenSharingOwner = participant.identity;

    const screenEl = attachVideoSafely(track, participant.identity, `screen-${participant.identity}`, true);
    if (screenEl) {
        screenEl.style.objectFit = "contain";
        pres.appendChild(screenEl);

        const ownerInfo = document.createElement('div');
        ownerInfo.className = "screen-owner-info";
        ownerInfo.innerHTML = `Shared by: ${participant.identity}`;
        ownerInfo.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 5px 10px;
            border-radius: 5px;
            font-size: 12px;
            z-index: 10;
        `;
        pres.appendChild(ownerInfo);
    }

    updateParticipantList();
}

function handleVideoTrack(track, participant, isLocal) {
    const cont = createVideoContainer(participant.identity, isLocal);
    const placeholder = document.getElementById(`placeholder-${participant.identity}`);
    if (placeholder) placeholder.style.display = 'none';

    const elementId = isLocal ? `local-${participant.identity}` : `track-${participant.identity}`;
    const el = attachVideoSafely(track, participant.identity, elementId, isLocal);
    if (el && cont) {
        cont.appendChild(el);
    }
}

function setupLocalVideo() {
    if (!room || !room.localParticipant) return;

    const localIdentity = room.localParticipant.identity;

    // Don't setup video if we're screen sharing
    if (room.localParticipant.isScreenShareEnabled) {
        console.log("Skipping video setup - screen sharing active");
        return;
    }

    // Try to get the video track
    const maxAttempts = 10;
    let attempts = 0;

    function checkForVideoTrack() {
        attempts++;

        // Check for video tracks
        if (room.localParticipant.videoTracks) {
            const videoTracks = Array.from(room.localParticipant.videoTracks.values());

            if (videoTracks.length > 0) {
                const videoPub = videoTracks[0];
                if (videoPub && videoPub.track) {
                    const placeholder = document.getElementById(`placeholder-${localIdentity}`);
                    if (placeholder) placeholder.style.display = 'none';

                    const existingVideo = document.getElementById(`local-${localIdentity}`);
                    if (existingVideo) existingVideo.remove();

                    const videoElement = videoPub.track.attach();
                    videoElement.id = `local-${localIdentity}`;
                    videoElement.autoplay = true;
                    videoElement.playsInline = true;
                    videoElement.muted = true;
                    videoElement.setAttribute("playsinline", "true");
                    videoElement.style.objectFit = "cover";
                    videoElement.style.width = "100%";
                    videoElement.style.height = "100%";
                    videoElement.style.backgroundColor = "#000";

                    const cont = document.getElementById(`cont-${localIdentity}`);
                    if (cont) {
                        cont.appendChild(videoElement);

                        videoElement.play().catch(e => {
                            videoElement.muted = true;
                            videoElement.play().catch(e2 => {});
                        });

                        return;
                    }
                }
            }
        }

        // If not found and haven't exceeded max attempts, try again
        if (attempts < maxAttempts) {
            setTimeout(checkForVideoTrack, 300);
        } else {
            // Only update placeholder if not screen sharing
            if (!room.localParticipant.isScreenShareEnabled) {
                const placeholder = document.getElementById(`placeholder-${localIdentity}`);
                if (placeholder) {
                    placeholder.innerHTML = `
                        <div class="initials-circle">${localIdentity.substring(0, 2).toUpperCase()}</div>
                        <span>${localIdentity} (Me)${isHost ? " (Host)" : ""}</span>
                    `;
                }
            }
        }
    }

    checkForVideoTrack();
}

function broadcastData(obj) {
    if (!room || !room.localParticipant) return;

    try {
        const data = new TextEncoder().encode(JSON.stringify(obj));
        room.localParticipant.publishData(data, LivekitClient.DataPacket_Kind.RELIABLE);
    } catch (error) {
        console.error("Error broadcasting data:", error);
    }
}

function handleChat(e) {
    if (e.key === 'Enter' && e.target.value !== "") {
        unlockAudioOnce();

        const msg = e.target.value;
        broadcastData({ type: "chat", msg: msg });
        appendMsg("Me", msg);
        e.target.value = '';
    }
}

function toggleHand() {
    if (!room || !room.localParticipant) return;

    handRaised = !handRaised;

    const btn = document.getElementById('hand-btn');
    if (btn) {
        btn.innerText = handRaised ? "❌ Lower Hand" : "✋ Raise Hand";
        btn.classList.toggle('hand-active', handRaised);
    }

    broadcastData({ type: "hand_toggle", raised: handRaised });
    showHandOnVideo(room.localParticipant.identity, handRaised);
}

function sendFile(input) {
    const file = input.files[0];
    if (!file || file.size > 5000000) return alert("File too large (Max 5MB)");

    const reader = new FileReader();
    reader.onload = () => {
        unlockAudioOnce();
        broadcastData({ type: "file", fileName: file.name, fileData: reader.result });
        appendFileMsg("Me", file.name, reader.result);
    };
    reader.readAsDataURL(file);
}

async function toggleMic() {
    if (!room || !room.localParticipant) return;

    try {
        const en = room.localParticipant.isMicrophoneEnabled;
        await room.localParticipant.setMicrophoneEnabled(!en);

        const micBtn = document.getElementById('mic-btn');
        if (micBtn) {
            micBtn.innerText = en ? "Unmute" : "Mute";
        }
    } catch (error) {
        console.error("Error toggling microphone:", error);
    }
}

async function toggleCam() {
    if (!room || !room.localParticipant) return;

    try {
        const en = room.localParticipant.isCameraEnabled;

        // Check if we're currently screen sharing
        const isSharingScreen = room.localParticipant.isScreenShareEnabled;

        if (isSharingScreen) {
            // If screen sharing, ask user for confirmation
            const confirmToggle = confirm("You are currently screen sharing. Turning off your camera won't affect the screen share. Continue?");
            if (!confirmToggle) return;
        }

        // Toggle camera
        await room.localParticipant.setCameraEnabled(!en);

        // Update button text
        const camBtn = document.getElementById('cam-btn');
        if (camBtn) {
            camBtn.innerText = en ? "Video On" : "Video Off";
        }

        const localIdentity = room.localParticipant.identity;
        const placeholder = document.getElementById(`placeholder-${localIdentity}`);

        if (en) {
            // Camera was turned OFF
            if (placeholder) {
                placeholder.style.display = 'flex';
                // Remove video element but keep container
                const videoEl = document.getElementById(`local-${localIdentity}`);
                if (videoEl) videoEl.remove();
            }
        } else {
            // Camera was turned ON
            if (placeholder) placeholder.style.display = 'none';

            // Only setup video if we're not in the middle of screen sharing
            if (!isSharingScreen) {
                setTimeout(() => setupLocalVideo(), 300);
            } else {
                // If screen sharing, just update the placeholder
                if (placeholder) {
                    placeholder.innerHTML = `
                        <div class="initials-circle">${localIdentity.substring(0, 2).toUpperCase()}</div>
                        <span>${localIdentity} (Me)${isHost ? " (Host)" : ""}</span>
                        <small style="margin-top: 5px; color: #ccc; font-size: 12px;">Screen Sharing Active</small>
                    `;
                }
            }
        }
    } catch (error) {
        console.error("Error toggling camera:", error);
        showError("Failed to toggle camera: " + error.message);
    }
}

async function shareScreen() {
    if (!room || !room.localParticipant) return;

    try {
        const isSharing = room.localParticipant.isScreenShareEnabled;
        const shareBtn = document.getElementById('share-btn');
        const localIdentity = room.localParticipant.identity;

        if (!isSharing) {
            // Starting to share
            console.log("Starting screen share");

            // Show loading state
            if (shareBtn) {
                shareBtn.innerText = "Starting...";
                shareBtn.disabled = true;
            }

            if (isHost) {
                broadcastData({ type: "host_sharing" });
            }

            // Notify others that we're starting to share
            broadcastData({
                type: "screen_share_control",
                action: "start",
                sharer: room.localParticipant.identity
            });

            // Start screen share
            await room.localParticipant.setScreenShareEnabled(true);

            // Update UI
            if (shareBtn) {
                shareBtn.innerText = "Stop";
                shareBtn.style.background = "#ea4335";
                shareBtn.disabled = false;
            }

            // Update local video placeholder if camera is off
            const placeholder = document.getElementById(`placeholder-${localIdentity}`);
            if (placeholder && !room.localParticipant.isCameraEnabled) {
                placeholder.innerHTML = `
                    <div class="initials-circle">${localIdentity.substring(0, 2).toUpperCase()}</div>
                    <span>${localIdentity} (Me)${isHost ? " (Host)" : ""}</span>
                    <small style="margin-top: 5px; color: #ccc; font-size: 12px;">Screen Sharing</small>
                `;
            }

        } else {
            // Stopping share
            console.log("Stopping screen share");

            if (shareBtn) {
                shareBtn.innerText = "Stopping...";
                shareBtn.disabled = true;
            }

            // Stop screen share
            await room.localParticipant.setScreenShareEnabled(false);

            // Update UI
            if (shareBtn) {
                shareBtn.innerText = "Share";
                shareBtn.style.background = "";
                shareBtn.disabled = false;
            }

            // Restore original placeholder if camera is off
            const placeholder = document.getElementById(`placeholder-${localIdentity}`);
            if (placeholder && !room.localParticipant.isCameraEnabled) {
                placeholder.innerHTML = `
                    <div class="initials-circle">${localIdentity.substring(0, 2).toUpperCase()}</div>
                    <span>${localIdentity} (Me)${isHost ? " (Host)" : ""}</span>
                `;
            }

            // Notify others that we stopped sharing
            broadcastData({
                type: "screen_share_control",
                action: "stop",
                sharer: room.localParticipant.identity
            });
        }

    } catch (error) {
        console.error("Error toggling screen share:", error);
        showError("Failed to toggle screen share: " + error.message);

        // Reset button on error
        const shareBtn = document.getElementById('share-btn');
        if (shareBtn) {
            shareBtn.innerText = "Share";
            shareBtn.style.background = "";
            shareBtn.disabled = false;
        }
    }
}

function toggleRecord() {
    if (!isHost || !room) return;

    isRecording = !isRecording;
    const btn = document.getElementById('rec-btn');
    if (btn) {
        btn.innerText = isRecording ? "Stop Rec" : "Record";
        btn.style.background = isRecording ? "#ea4335" : "#333";
    }

    const recStatus = document.getElementById('rec-status');
    if (recStatus) {
        recStatus.style.display = isRecording ? "flex" : "none";
    }

    broadcastData({ type: "rec_sync", status: isRecording });
}

function muteAll() {
    if (!isHost || !room) return;
    broadcastData({ type: "mute_all" });
    appendMsg("System", "You muted everyone.");
}

function leaveRoom() {
    if (room) room.disconnect();
    location.reload();
}

function copyCode() {
    if (!isHost) return;

    const text = document.getElementById('display-code').innerText;
    navigator.clipboard.writeText(text.replace("Hosting: ", "").trim());
    alert("Code Copied!");
}

function appendMsg(user, msg, isHand = false) {
    const div = document.createElement('div');
    if (isHand) div.className = "hand-notification";
    div.innerHTML = `<p><strong>${user}:</strong> ${msg}</p>`;
    const box = document.getElementById('chat-messages');
    if (box) {
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    }
}

function appendFileMsg(user, fileName, fileData) {
    const box = document.getElementById('chat-messages');
    if (!box) return;

    const div = document.createElement('div');
    div.innerHTML = `<strong>${user}:</strong> <a href="${fileData}" download="${fileName}" class="file-msg">📄 ${fileName}</a>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function dragElement(elmnt) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    elmnt.onmousedown = (e) => {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = () => { document.onmouseup = null; document.onmousemove = null; };
        document.onmousemove = (e) => {
            e.preventDefault();
            pos1 = pos3 - e.clientX;
            pos2 = pos4 - e.clientY;
            pos3 = e.clientX;
            pos4 = e.clientY;
            elmnt.style.top = (elmnt.offsetTop - pos2) + "px";
            elmnt.style.left = (elmnt.offsetLeft - pos1) + "px";
        };
    };
}

// Prevent scrolling on video containers
document.addEventListener('DOMContentLoaded', function() {
    const videoGrid = document.getElementById('video-grid');
    if (videoGrid) {
        videoGrid.addEventListener('wheel', function(e) {
            if (e.target.closest('.video-container')) {
                e.preventDefault();
            }
        }, { passive: false });
    }

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('click', function() {
            this.focus();
        });
    }
});
