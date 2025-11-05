// --- JAVASCRIPT ---

// שימוש במשתנים גלובליים ספציפיים וקבועים
const DOM_ELEMENTS = {
    // טאבים
    tabs: document.querySelectorAll('.tab-btn'),
    contents: document.querySelectorAll('.tab-content'),
    // קריאה מיידית
    startBtn: document.getElementById('start-record'),
    stopBtn: document.getElementById('stop-record'),
    sendPanicBtn: document.getElementById('send-panic'),
    playback: document.getElementById('panic-playback'),
    recordStatus: document.getElementById('record-status'),
    // שירים
    songList: document.getElementById('song-list'),
    addSongBtn: document.getElementById('add-song-btn'),
    addSongModal: document.getElementById('add-song-modal'),
    cancelSongBtn: document.getElementById('cancel-song-btn'),
    saveSongBtn: document.getElementById('save-song-btn'),
    newSongName: document.getElementById('new-song-name'),
    newSongFile: document.getElementById('new-song-file'),
    waveform: document.getElementById('waveform'),
    clipStartLabel: document.getElementById('clip-start-label'),
    clipEndLabel: document.getElementById('clip-end-label'),
    clipStartRange: document.getElementById('clip-start-range'),
    clipEndRange: document.getElementById('clip-end-range'),
    songForm: document.getElementById('song-form'),
    // אירועים
    eventsList: document.getElementById('events-list'),
    openEventModalBtn: document.getElementById('open-event-modal'),
    eventModal: document.getElementById('event-modal'),
    cancelEventBtn: document.getElementById('cancel-event-btn'),
    saveEventBtn: document.getElementById('save-event-btn'),
    newEventName: document.getElementById('new-event-name'),
    newEventTime: document.getElementById('new-event-time'),
    newEventDay: document.getElementById('new-event-day'),
    eventSongSelect: document.getElementById('event-song-select'),
    eventForm: document.getElementById('event-form')
};

let songs = [];
let events = [];
let mediaRecorder;
let audioChunks = [];
let audioBuffer; // מאחסן את נתוני הקול ל-Waveform
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const canvasCtx = DOM_ELEMENTS.waveform.getContext('2d');
let currentSongId = -1; // ה-ID של השיר הנערך/נשמר כרגע
let isSongEditMode = false;
let isEditMode = false;
let editingEventIndex = -1;
let panicAudioBlob = null;

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initPanicRecorder();
    initSongsManager();
    initEventsManager();
    
    loadDataFromApi();
    requestMicrophoneAccess();
});


// --- מבנה נתונים וטעינה ---
async function loadDataFromApi() {
    try {
        // שינוי ל-API מאוחד כפי שמוגדר בשרת הפייתון
        const response = await fetch('/api/data');
        if (!response.ok) throw new Error('Failed to fetch data');
        const data = await response.json();
        
        // ודא שהמזהים מעודכנים
        songs = data.songs.map(s => ({...s, id: isNaN(s.id) ? s.id : parseInt(s.id)}) ) || [];
        events = data.events.map(e => ({...e, id: isNaN(e.id) ? e.id : parseInt(e.id)}) ) || [];
        
        renderSongList();
        renderEvents();
    } catch (err) {
        console.error("שגיאה בטעינת נתונים מהשרת:", err);
        alert('שגיאה בטעינת נתונים: ודא ששרת הפייתון פועל. ' + err.message);
    }
}
async function requestMicrophoneAccess() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        DOM_ELEMENTS.recordStatus.textContent = "✅ המיקרופון נגיש.";
        stream.getTracks().forEach(track => track.stop());
        return true;
    } catch (err) {
        console.warn("שגיאה/סירוב גישה למיקרופון:", err.message);
        DOM_ELEMENTS.recordStatus.textContent = "⚠️ גישה למיקרופון נדחתה או נחסמה.";
        DOM_ELEMENTS.startBtn.disabled = true;
        return false;
    }
}

// --- טאבים ---
function initTabs() {
    DOM_ELEMENTS.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            
            // 1. סגירת כל המודלים לפני החלפת הטאב
            DOM_ELEMENTS.eventModal.style.display = 'none';
            DOM_ELEMENTS.addSongModal.style.display = 'none';
            
            // 2. החלפת המצב הפעיל של הטאבים
            DOM_ELEMENTS.tabs.forEach(t => t.classList.remove('active'));
            DOM_ELEMENTS.contents.forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            
            // 3. הצגת הטאב החדש
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });
}

// --- מימוש קריאה מיידית (פאניקה) ---
function initPanicRecorder() {
    DOM_ELEMENTS.startBtn.addEventListener('click', async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // ודא שה-MediaRecorder תומך ב-mimeType רצוי
            const options = { mimeType: 'audio/webm' };
            mediaRecorder = new MediaRecorder(stream, options);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };
            
            mediaRecorder.onstop = () => {
                const mimeType = mediaRecorder.mimeType.split(';')[0];
                panicAudioBlob = new Blob(audioChunks, { type: mimeType });
                DOM_ELEMENTS.playback.src = URL.createObjectURL(panicAudioBlob);
                
                DOM_ELEMENTS.stopBtn.disabled = true;
                DOM_ELEMENTS.sendPanicBtn.disabled = false;
                DOM_ELEMENTS.startBtn.disabled = false;
                DOM_ELEMENTS.recordStatus.textContent = "הקלטה הושלמה. ניתן לשלוח או להקליט מחדש.";
                stream.getTracks().forEach(track => track.stop());
            };
            
            mediaRecorder.start();
            DOM_ELEMENTS.recordStatus.textContent = "🔴 מקליט...";
            DOM_ELEMENTS.startBtn.disabled = true;
            DOM_ELEMENTS.stopBtn.disabled = false;
            DOM_ELEMENTS.sendPanicBtn.disabled = true;

        } catch (err) {
            alert(`שגיאה בגישה למיקרופון: ${err.message}.`);
            DOM_ELEMENTS.recordStatus.textContent = "שגיאה בגישה למיקרופון.";
            DOM_ELEMENTS.startBtn.disabled = true; // אם נכשל, נשבית
        }
    });

    DOM_ELEMENTS.stopBtn.addEventListener('click', () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            DOM_ELEMENTS.recordStatus.textContent = "מעבד הקלטה...";
        }
    });

    DOM_ELEMENTS.sendPanicBtn.addEventListener('click', async () => {
        if (!panicAudioBlob) return alert('⚠️ אין הקלטה לשליחה.');
        
        DOM_ELEMENTS.sendPanicBtn.disabled = true;
        DOM_ELEMENTS.recordStatus.textContent = "🚀 שולח ומפעיל קריאה...";

        const formData = new FormData();
        // שליחת הקובץ עם סיומת mp3 לצורך שמירה נכונה בשרת הפייתון
        const filename = 'panic_message.mp3';
        formData.append('file', panicAudioBlob, filename);

        try {
            const response = await fetch('/api/panic', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('שגיאה בשליחת הקריאה לשרת');
            
            const result = await response.json();
            alert('✅ הקלטה נשלחה ונשמרה בתיקיית הפאניקה! שם הקובץ: ' + result.filename);
            DOM_ELEMENTS.recordStatus.textContent = "✅ קריאה מיידית נשלחה ונשמרה.";
            
        } catch (err) {
            console.error("שגיאה בהפעלת קריאה מיידית:", err);
            alert('⚠️ שגיאה בהפעלת קריאה מיידית: ' + err.message);
            DOM_ELEMENTS.recordStatus.textContent = "❌ שגיאה בהפעלה.";
        } finally {
            DOM_ELEMENTS.playback.src = '';
            panicAudioBlob = null;
            DOM_ELEMENTS.sendPanicBtn.disabled = false;
        }
    });
}


// --- ניהול שירים (עם פונקציות Waveform מלאות) ---
function initSongsManager() {
    DOM_ELEMENTS.addSongBtn.addEventListener('click', () => openSongModal(false));
    DOM_ELEMENTS.cancelSongBtn.addEventListener('click', () => DOM_ELEMENTS.addSongModal.style.display = 'none');
    DOM_ELEMENTS.newSongFile.addEventListener('change', loadWaveform);
    DOM_ELEMENTS.songForm.addEventListener('submit', saveSong);
    DOM_ELEMENTS.clipStartRange.addEventListener('input', updateClipRange);
    DOM_ELEMENTS.clipEndRange.addEventListener('input', updateClipRange);
}

function openSongModal(isEdit, songData = {}) {
    isSongEditMode = isEdit;
    currentSongId = songData.id || -1;
    
    DOM_ELEMENTS.addSongModal.style.display = 'flex';
    DOM_ELEMENTS.newSongName.value = songData.name || '';
    DOM_ELEMENTS.newSongFile.value = ''; // ניקוי שדה הקובץ
    DOM_ELEMENTS.saveSongBtn.textContent = isEdit ? 'שמור שינויים' : 'העלה ושמור שיר';
    
    // ניקוי ובדיקת Waveform במצב עריכה
    if (isEdit && songData.url) {
        // טוען את קובץ השיר הקיים כדי להציג את ה-Waveform
        fetch(songData.url)
            .then(res => {
                if (!res.ok) throw new Error('Failed to fetch song file');
                return res.arrayBuffer();
            })
            .then(buffer => audioCtx.decodeAudioData(buffer))
            .then(decodedData => {
                audioBuffer = decodedData;
                
                // הגדרת טווחי הגלילה
                const duration = audioBuffer.duration;
                DOM_ELEMENTS.clipStartRange.max = duration.toFixed(2);
                DOM_ELEMENTS.clipEndRange.max = duration.toFixed(2);
                
                // הגדרת טווחי החיתוך הקיימים מהנתונים
                const start = songData.clipStart || 0;
                const end = songData.clipEnd || duration.toFixed(2);
                DOM_ELEMENTS.clipStartRange.value = start;
                DOM_ELEMENTS.clipEndRange.value = end;
                
                drawWaveform(start, end); // ציור עם הפסים הממוקמים
                updateClipRange();
            })
            .catch(err => {
                console.error("Error loading existing song for waveform:", err);
                alert("שגיאה בטעינת קובץ שיר קיים.");
            });
    } else {
        // ניקוי Waveform במצב חדש
        audioBuffer = null;
        canvasCtx.clearRect(0, 0, DOM_ELEMENTS.waveform.width, DOM_ELEMENTS.waveform.height);
        DOM_ELEMENTS.clipStartRange.value = 0;
        DOM_ELEMENTS.clipEndRange.value = 0;
        DOM_ELEMENTS.clipStartRange.max = 10;
        DOM_ELEMENTS.clipEndRange.max = 10;
        DOM_ELEMENTS.clipStartLabel.textContent = "0.00 שניות";
        DOM_ELEMENTS.clipEndLabel.textContent = "0.00 שניות";
    }
}

// 🎼 טעינת ה-Waveform מקובץ נבחר
function loadWaveform(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        audioCtx.decodeAudioData(e.target.result)
            .then(decodedData => {
                audioBuffer = decodedData;
                
                // הגדרת טווחי הגלילה (Range Sliders)
                const duration = audioBuffer.duration;
                DOM_ELEMENTS.clipStartRange.max = duration.toFixed(2);
                DOM_ELEMENTS.clipEndRange.max = duration.toFixed(2);
                
                // הגדרת ברירת מחדל: כל השיר
                DOM_ELEMENTS.clipStartRange.value = 0;
                DOM_ELEMENTS.clipEndRange.value = duration.toFixed(2);

                drawWaveform(0, duration);
                updateClipRange();
            })
            .catch(err => {
                console.error("Error decoding audio data:", err);
                alert("שגיאה בפענוח קובץ הקול. ודא שהוא קובץ MP3/WAV תקין.");
            });
    };
    reader.readAsArrayBuffer(file);
}

// 🌊 ציור ה-Waveform עם פסי חיתוך - תוקן הבאג בחישוב המקסימום
function drawWaveform(clipStart = 0, clipEnd = 0) {
    if (!audioBuffer) return;

    const width = DOM_ELEMENTS.waveform.width;
    const height = DOM_ELEMENTS.waveform.height;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;

    canvasCtx.clearRect(0, 0, width, height);
    canvasCtx.fillStyle = '#1c7ed6'; // צבע ה-waveform

    for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
            const datum = data[(i * step) + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum; // <--- התיקון הקריטי כאן!
        }
        canvasCtx.fillRect(i, (1 + min) * amp, 1, Math.max(1, (max - min) * amp));
    }

    // --- ציור פסי חיתוך ---
    const duration = audioBuffer.duration;
    
    // חישוב מיקום הפסים באחוזים יחסי לרוחב הקנבס
    const startX = (clipStart / duration) * width;
    const endX = (clipEnd / duration) * width;

    // פס התחלה אדום
    canvasCtx.strokeStyle = 'red';
    canvasCtx.lineWidth = 2;
    canvasCtx.beginPath();
    canvasCtx.moveTo(startX, 0);
    canvasCtx.lineTo(startX, height);
    canvasCtx.stroke();

    // פס סיום ירוק
    canvasCtx.strokeStyle = 'green';
    canvasCtx.lineWidth = 2;
    canvasCtx.beginPath();
    canvasCtx.moveTo(endX, 0);
    canvasCtx.lineTo(endX, height);
    canvasCtx.stroke();
}

// ✂️ עדכון טווחי החיתוך וציור מחדש
function updateClipRange() {
    const start = parseFloat(DOM_ELEMENTS.clipStartRange.value);
    const end = parseFloat(DOM_ELEMENTS.clipEndRange.value);
    
    // ודא שהסוף גדול או שווה להתחלה
    if (end < start) {
        DOM_ELEMENTS.clipEndRange.value = start;
    }

    const newStart = parseFloat(DOM_ELEMENTS.clipStartRange.value);
    const newEnd = parseFloat(DOM_ELEMENTS.clipEndRange.value);

    DOM_ELEMENTS.clipStartLabel.textContent = `${newStart.toFixed(2)} שניות`;
    DOM_ELEMENTS.clipEndLabel.textContent = `${newEnd.toFixed(2)} שניות`;

    if (audioBuffer) {
        drawWaveform(newStart, newEnd);
    }
}

// 💾 שמירת שיר ושליחתו לשרת
async function saveSong(e) {
    e.preventDefault();
    
    const name = DOM_ELEMENTS.newSongName.value.trim();
    const clipStart = parseFloat(DOM_ELEMENTS.clipStartRange.value);
    const clipEnd = parseFloat(DOM_ELEMENTS.clipEndRange.value);
    
    if (!name || isNaN(clipStart) || isNaN(clipEnd) || clipEnd <= clipStart) {
        return alert('⚠️ יש למלא שם שיר ולהגדיר טווח חיתוך תקין (סיום > התחלה).');
    }
    
    let file = DOM_ELEMENTS.newSongFile.files[0];
    
    if (!isSongEditMode && !file) {
        return alert('⚠️ במצב יצירת שיר חדש חובה לצרף קובץ.');
    }
    
    const formData = new FormData();
    const songMetadata = {
        name: name,
        clipStart: clipStart,
        clipEnd: clipEnd
    };
    
    if (isSongEditMode) {
        songMetadata.id = currentSongId;
    }
    
    // טיפול בבחירת קובץ
    if (file) {
        formData.append('file', file, file.name);
    } else if (isSongEditMode) {
        // אם אין קובץ חדש במצב עריכה, שולחים קובץ ריק עם שם מיוחד.
        const emptyBlob = new Blob([""], { type: 'application/octet-stream' });
        formData.append('file', emptyBlob, 'no_change.txt');
    }

    formData.append('metadata', JSON.stringify(songMetadata));

    try {
        const response = await fetch('/api/songs', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error('Failed to save song on server: ' + errorText);
        }
        
        await loadDataFromApi();
        DOM_ELEMENTS.addSongModal.style.display = 'none';
        alert('✅ השיר נשמר/עודכן בהצלחה!');

    } catch (err) {
        console.error("שגיאה בשמירת שיר:", err);
        alert('⚠️ שגיאה בשמירת שיר: ' + err.message);
    }
}

// 🗑️ מימוש מחיקת שיר
async function removeSong(id) {
    if (confirm('בטוח/ה שברצונך למחוק שיר זה? קובץ השיר יימחק מהאחסון.')) {
        try {
            const response = await fetch(`/api/song/${id}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('שגיאה במחיקת השיר מהשרת');
            
            await loadDataFromApi();
            alert('🗑️ השיר נמחק בהצלחה!');
            
        } catch (err) {
            console.error("שגיאה במחיקת שיר:", err);
            alert('⚠️ שגיאה במחיקת שיר: ' + err.message);
        }
    }
}
window.removeSong = removeSong;
window.editSong = (id) => {
    // השתמש ב-== כי המזהה מה-DOM יכול להיות String ואילו מה-API יכול להיות Number
    const songToEdit = songs.find(s => s.id == id);
    if(songToEdit) {
        openSongModal(true, songToEdit);
    }
};

// --- ניהול אירועים ---
function initEventsManager() {
    DOM_ELEMENTS.openEventModalBtn.addEventListener('click', () => {
        openEventModal(false);
    });

    DOM_ELEMENTS.cancelEventBtn.addEventListener('click', () => {
        DOM_ELEMENTS.eventModal.style.display = 'none';
    });

    DOM_ELEMENTS.eventForm.addEventListener('submit', handleSaveEvent);

    DOM_ELEMENTS.eventsList.addEventListener('click', (e) => {
        const target = e.target.closest('button');
        if (!target) return;

        // ודא ש-ID הוא string למקרה של UUID
        const eventId = String(target.dataset.id);
        
        if (target.classList.contains('del')) {
            handleDeleteEvent(eventId);
        }
        if (target.classList.contains('edit')) {
            handleEditEvent(eventId);
        }
    });
}

function openEventModal(isEdit, eventData = {}) {
    DOM_ELEMENTS.newEventName.value = eventData.name || '';
    DOM_ELEMENTS.newEventTime.value = eventData.time || '09:00';
    DOM_ELEMENTS.newEventDay.value = eventData.day || 'ראשון';
    DOM_ELEMENTS.saveEventBtn.textContent = isEdit ? 'שמור שינויים' : 'שמור אירוע';
    
    isEditMode = isEdit;
    editingEventIndex = eventData.id || -1;
    
    // מילוי סלקט השירים
    DOM_ELEMENTS.eventSongSelect.innerHTML = '<option value="">בחר שיר...</option>';
    songs.forEach(song => {
        const option = document.createElement('option');
        // ודא ש-value הוא string אם המזהים הם UUID
        option.value = String(song.id);
        option.textContent = song.name;
        if (String(song.id) === String(eventData.songId)) {
            option.selected = true;
        }
        DOM_ELEMENTS.eventSongSelect.appendChild(option);
    });
    
    DOM_ELEMENTS.eventModal.style.display = 'flex';
}

// 💾 מימוש שמירה/עדכון אירוע + בדיקת קלט
function handleSaveEvent(e) {
    e.preventDefault();
    
    const name = DOM_ELEMENTS.newEventName.value.trim();
    const time = DOM_ELEMENTS.newEventTime.value;
    const day = DOM_ELEMENTS.newEventDay.value;
    // ודא ש-songId נשמר כ-string אם המזהים הם UUID
    const songId = DOM_ELEMENTS.eventSongSelect.value;

    // ✅ אימות קלט מקיף
    if (!name || name.length < 2) return alert('⚠️ יש להזין שם אירוע תקין (מינימום 2 תווים).');
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return alert('⚠️ יש להזין שעה בפורמט HH:MM.');
    if (!day) return alert('⚠️ יש לבחור יום בשבוע.');
    if (!songId) return alert('⚠️ יש לבחור שיר מתוך הרשימה.');

    const eventData = { name, time, day, songId: songId };
    let apiPath = '/api/event';
    let method = 'POST';

    // ✏️ אם זה מצב עריכה, שולחים PUT עם ה-ID
    if (isEditMode) {
        eventData.id = editingEventIndex;
        apiPath = `/api/event/${editingEventIndex}`;
        method = 'PUT';
    }
    
    fetch(apiPath, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventData)
    })
    .then(response => {
        if (!response.ok) throw new Error('Failed to save/update event on server');
        return response.json();
    })
    .then(() => {
        loadDataFromApi();
        DOM_ELEMENTS.eventModal.style.display = 'none';
        alert(`✅ אירוע ${isEditMode ? 'עודכן' : 'נשמר'} בהצלחה!`);
    })
    .catch(err => {
        console.error("שגיאה בשמירת/עדכון אירוע:", err);
        alert('שגיאה בשמירת אירוע: ' + err.message);
    });
}

// 🗑️ מימוש מחיקת אירוע
function handleDeleteEvent(id) {
    if (confirm('בטוח/ה שברצונך למחוק אירוע זה?')) {
        fetch(`/api/event/${id}`, {
            method: 'DELETE'
        })
        .then(response => {
            if (!response.ok) throw new Error('Failed to delete event on server');
            return response.json();
        })
        .then(() => {
            loadDataFromApi();
            alert('🗑️ האירוע נמחק בהצלחה!');
        })
        .catch(err => {
            console.error("שגיאה במחיקת אירוע:", err);
            alert('שגיאה במחיקת אירוע: ' + err.message);
        });
    }
}

// ✏️ מימוש עריכת אירוע
function handleEditEvent(id) {
    const ev = events.find(event => String(event.id) === String(id));
    if (ev) {
        openEventModal(true, ev);
    }
}

// --- רינדור ---
function renderEvents() {
    DOM_ELEMENTS.eventsList.innerHTML = '';
    const daysOrder = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    
    const sortedEvents = events.sort((a, b) => {
        const dayA = daysOrder.indexOf(a.day);
        const dayB = daysOrder.indexOf(b.day);
        if (dayA !== dayB) return dayA - dayB;
        return a.time.localeCompare(b.time);
    });

    sortedEvents.forEach(ev => {
        // שימוש ב-== כי songId יכול להיות string או number
        const song = songs.find(s => String(s.id) === String(ev.songId));
        const songName = song ? song.name : 'שיר לא קיים';
        
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${ev.day}, ${ev.time}</span>
            <strong>${ev.name}</strong>
            <span class="song-link">${songName}</span>
            <div class="actions">
                <button class="edit" data-id="${ev.id}">✏️</button>
                <button class="del" data-id="${ev.id}">🗑️</button>
            </div>
        `;
        DOM_ELEMENTS.eventsList.appendChild(li);
    });
}

function renderSongList() {
    DOM_ELEMENTS.songList.innerHTML = '';
    songs.forEach(song => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${song.name}</span>
            <span class="clip-info">(${parseFloat(song.clipStart).toFixed(2)} - ${parseFloat(song.clipEnd).toFixed(2)} שניות)</span>
            <div class="actions">
                <button onclick="editSong('${song.id}')" class="edit">✏️</button>
                <button onclick="removeSong('${song.id}')" class="del">🗑️</button>
            </div>
        `;
        DOM_ELEMENTS.songList.appendChild(li);
    });
}
