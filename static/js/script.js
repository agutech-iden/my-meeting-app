let room;
let isHost = false;
let isRecording = false;
let handRaised = false;

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

// Try to unlock sound on first interaction after join
window.addEventListener('click', unlockAudioOnce, { once: true });
window.addEventListener('keydown', unlockAudioOnce, { once: true });

function showTab(type) {
    document.getElementById('host-tab').style.display = type === 'host' ? 'block' : 'none';
    document.getElementById('join-tab').style.display = type === 'join' ? 'block' : 'none';
    document.getElementById('btn-h').classList.toggle('active', type === 'host');
    document.getElementById('btn-j').classList.toggle('active', type === 'join');
}

async function startMeeting(asHost) {
    isHost = asHost;

    const user = document.getElementById('username').value;
    const title = document.getElementById('m-title').value;
    if (!user || !title) return alert("Enter Name and Title");

    const res = await fetch('/create_meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, title, start: "now", end: "later" })
    });

    const data = await res.json();
    await handleJoin(user, data.code, true, title);
}

async function joinMeeting() {
    isHost = false;

    const user = document.getElementById('username').value;
    const code = document.getElementById('room-code-input').value.toUpperCase();
    if (!user || !code) return alert("Enter Name and Code!");
    await handleJoin(user, code, false, "");
}

function applyRolePermissions(roomCode, meetingTitle) {
    // Host sees code and copy button
    const display = document.getElementById('display-code');
    const copyBtn = document.getElementById('copy-btn');

    if (!isHost) {
        if (copyBtn) copyBtn.remove();

        // Hide meeting code from participants
        if (display) {
            display.innerText = meetingTitle ? `Meeting: ${meetingTitle}` : "Meeting";
        }

        // Non-host should not record/mute-all by UI
        if (document.getElementById('rec-btn')) document.getElementById('rec-btn').remove();
        if (document.getElementById('host-mute-btn')) document.getElementById('host-mute-btn').remove();
    } else {
        // Host shows real code
        if (display) display.innerText = "Meeting Code: " + roomCode;
        const muteAllBtn = document.getElementById('host-mute-btn');
        if (muteAllBtn) muteAllBtn.style.display = "inline-block";
    }
}

function togglePanel(id) {
    const p = document.getElementById(id);
    p.style.display = (p.style.display === 'flex') ? 'none' : 'flex';
    if (id === 'participant-panel') updateParticipantList();
}

function updateLayoutSoloMode() {
    const grid = document.getElementById('video-grid');
    if (!grid || !room) return;

    const totalPeople = 1 + room.participants.size; // local + remotes
    grid.classList.toggle('solo', totalPeople <= 1);
}

function updateParticipantList() {
    if (!room) return;

    const list = document.getElementById('participant-list');
    if (!list) return;

    list.innerHTML = "";

    // Local participant
    list.innerHTML += `<div class="p-row"><strong>${room.localParticipant.identity} (Me)</strong></div>`;

    // Remote participants (Map)
    room.participants.forEach((p) => {
        list.innerHTML += `<div class="p-row">${p.identity}</div>`;
    });

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
                <span>${identity}${isLocal ? " (Me)" : ""}</span>
            </div>
        `;
        document.getElementById('video-grid').appendChild(cont);
    }
    return cont;
}

function attachVideoSafely(track, identity, elementId, muteIt = false) {
    const el = track.attach();
    el.id = elementId;

    // Mobile friendliness
    el.autoplay = true;
    el.playsInline = true;
    el.muted = muteIt;  // local video should be muted to prevent feedback
    el.setAttribute("playsinline", "true");

    // Attempt play (some browsers require this after user interaction)
    const p = el.play();
    if (p) p.catch(() => {});

    return el;
}

function showHandOnVideo(userId, raised) {
    const badge = document.getElementById(`hand-${userId}`);
    if (badge) badge.style.display = raised ? "block" : "none";
}

async function handleJoin(username, roomCode, asHostFlag, meetingTitle) {
    try {
        isHost = asHostFlag;

        const response = await fetch('/get_token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room: roomCode, user: username, isHost: isHost })
        });
        const data = await response.json();

        room = new LivekitClient.Room({ adaptiveStream: true, dynacast: true });

        // Register events BEFORE connect
        room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, pub, participant) => {
            const isScreen = track.source === LivekitClient.Track.Source.ScreenShare;

            if (isScreen) {
                document.getElementById('main-area').classList.add('sharing-active');
                const pres = document.getElementById('presentation-area');
                pres.innerHTML = "";

                const screenEl = attachVideoSafely(track, participant.identity, `screen-${participant.identity}`, true);
                screenEl.style.objectFit = "contain";
                pres.appendChild(screenEl);
            } else if (track.kind === "video") {
                const cont = createVideoContainer(participant.identity, false);
                const placeholder = document.getElementById(`placeholder-${participant.identity}`);
                if (placeholder) placeholder.style.display = 'none';

                const el = attachVideoSafely(track, participant.identity, `track-${participant.identity}`, false);
                cont.appendChild(el);
            }

            updateLayoutSoloMode();
        });

        room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, pub, participant) => {
            if (track.source === LivekitClient.Track.Source.ScreenShare) {
                document.getElementById('main-area').classList.remove('sharing-active');
                const pres = document.getElementById('presentation-area');
                pres.innerHTML = "";
            } else if (track.kind === "video") {
                const placeholder = document.getElementById(`placeholder-${participant.identity}`);
                if (placeholder) placeholder.style.display = 'flex';
                const el = document.getElementById(`track-${participant.identity}`);
                if (el) el.remove();
            }

            updateLayoutSoloMode();
        });

        room.on(LivekitClient.RoomEvent.DataReceived, (payload, participant) => {
            const decoded = new TextDecoder().decode(payload);
            let msgData;
            try { msgData = JSON.parse(decoded); } catch { return; }

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
        });

        room.on(LivekitClient.RoomEvent.ParticipantConnected, () => {
            updateParticipantList();
            updateLayoutSoloMode();
        });

        room.on(LivekitClient.RoomEvent.ParticipantDisconnected, (p) => {
            const cont = document.getElementById(`cont-${p.identity}`);
            if (cont) cont.remove();
            updateParticipantList();
            updateLayoutSoloMode();
        });

        // Connect
        await room.connect('wss://agutech-mini-zoom-dtc5dowj.livekit.cloud', data.token);

        // UI switch AFTER connect
        document.getElementById('dashboard-screen').style.display = 'none';
        document.getElementById('meeting-room').style.display = 'flex';

        applyRolePermissions(roomCode, meetingTitle);

        // Enable local media
        await room.localParticipant.setCameraEnabled(true);
        await room.localParticipant.setMicrophoneEnabled(true);

        // Setup Local Video tile
        const localIdentity = room.localParticipant.identity;
        const localCont = createVideoContainer(localIdentity, true);

        const videoPub = Array.from(room.localParticipant.videoTracks.values())[0];
        if (videoPub && videoPub.track) {
            const placeholder = document.getElementById(`placeholder-${localIdentity}`);
            if (placeholder) placeholder.style.display = 'none';

            const el = attachVideoSafely(videoPub.track, localIdentity, `local-${localIdentity}`, true);
            localCont.appendChild(el);
        }

        // Ensure participant list/layout updates even if events arrive slightly later
        updateParticipantList();
        updateLayoutSoloMode();
        setTimeout(updateParticipantList, 400);

    } catch (e) {
        alert("Error joining: " + e.message);
    }
}

function broadcastData(obj) {
    if (!room) return;
    const data = new TextEncoder().encode(JSON.stringify(obj));
    room.localParticipant.publishData(data, LivekitClient.DataPacket_Kind.RELIABLE);
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
    handRaised = !handRaised;

    const btn = document.getElementById('hand-btn');
    btn.innerText = handRaised ? "❌ Lower Hand" : "✋ Raise Hand";
    btn.classList.toggle('hand-active', handRaised);

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
    const en = room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(!en);
    document.getElementById('mic-btn').innerText = en ? "Unmute" : "Mute";
}

async function toggleCam() {
    const en = room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(!en);

    // Better button labels
    document.getElementById('cam-btn').innerText = en ? "Video On" : "Video Off";

    const placeholder = document.getElementById(`placeholder-${room.localParticipant.identity}`);
    if (placeholder) placeholder.style.display = en ? 'flex' : 'none';
}

async function shareScreen() {
    const isSharing = room.localParticipant.isScreenShareEnabled;
    if (!isSharing && isHost) broadcastData({ type: "host_sharing" });

    await room.localParticipant.setScreenShareEnabled(!isSharing);
    document.getElementById('share-btn').innerText = isSharing ? "Share" : "Stop";
}

function toggleRecord() {
    if (!isHost) return;

    isRecording = !isRecording;
    const btn = document.getElementById('rec-btn');
    btn.innerText = isRecording ? "Stop Rec" : "Record";
    btn.style.background = isRecording ? "#ea4335" : "#333";
    document.getElementById('rec-status').style.display = isRecording ? "flex" : "none";

    broadcastData({ type: "rec_sync", status: isRecording });
}

function muteAll() {
    if (!isHost) return;
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
    // expected: "Meeting Code: XXXXXXXX"
    navigator.clipboard.writeText(text.replace("Meeting Code: ", "").trim());
    alert("Code Copied!");
}

function appendMsg(user, msg, isHand = false) {
    const div = document.createElement('div');
    if (isHand) div.className = "hand-notification";
    div.innerHTML = `<p><strong>${user}:</strong> ${msg}</p>`;
    const box = document.getElementById('chat-messages');
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function appendFileMsg(user, fileName, fileData) {
    const box = document.getElementById('chat-messages');
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
