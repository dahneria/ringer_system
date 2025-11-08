from flask import Flask, jsonify, request, render_template, send_file
import os
import json
import logging
from werkzeug.utils import secure_filename
import uuid
import requests # נדרש לשליחת Webhooks

# --- הגדרות ---
app = Flask(__name__, template_folder='templates', static_folder='static')
app.config['UPLOAD_FOLDER'] = 'storage'

# תיקיות אחסון
EVENTS_FOLDER = os.path.join(app.config['UPLOAD_FOLDER'], 'events')
SONGS_FOLDER = os.path.join(app.config['UPLOAD_FOLDER'], 'songs')
PANIC_FOLDER = os.path.join(app.config['UPLOAD_FOLDER'], 'panic')

# --- הגדרות Webhook ---
# רשימת כתובות הרסיברים המקומיים שלך (כל Raspberry Pi)
# **חובה לעדכן:** שנה את הכתובות האלו לכתובות ה-IP/פורטים המדויקים של הרסיברים ברשת שלך
RECEIVER_URLS = [
    "http://192.168.1.227:5000/api/webhook_receive", # רסיבר 1
    "http://192.168.1.102:5000/api/webhook_receive"  # רסיבר 2
]

os.makedirs(EVENTS_FOLDER, exist_ok=True)
os.makedirs(SONGS_FOLDER, exist_ok=True)
os.makedirs(PANIC_FOLDER, exist_ok=True)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - (Server) - %(message)s')

# --- פונקציות עזר כלליות ---
def get_item_by_id(folder, item_id):
    """מחפש ומחזיר פריט JSON לפי מזהה"""
    filepath = os.path.join(folder, f"{item_id}.json")
    if os.path.exists(filepath):
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return None
    return None

def list_json_files(folder):
    """רשימה של כל קבצי ה-JSON בתיקייה נתונה"""
    items = []
    for filename in os.listdir(folder):
        if filename.endswith('.json'):
            try:
                filepath = os.path.join(folder, filename)
                with open(filepath, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    items.append(data)
            except Exception as e:
                logging.warning(f"שגיאה בקריאת קובץ {filename}: {e}")
    return items

def save_json_file(folder, data, file_id=None):
    """שמירת נתונים לקובץ JSON"""
    if not file_id:
        file_id = str(uuid.uuid4())
        data['id'] = file_id
    
    data['id'] = str(data['id'])
    filepath = os.path.join(folder, f"{data['id']}.json")
    
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data

def upload_and_save_file(file, folder, original_filename):
    """שמירה מאובטחת של קובץ והחזרת השם הייחודי שנוצר."""
    filename_secured = secure_filename(original_filename)
    extension = os.path.splitext(filename_secured)[1]
    unique_filename = str(uuid.uuid4()) + (extension if extension else '.mp3')
    file_path = os.path.join(folder, unique_filename)
    file.save(file_path)
    return unique_filename

def delete_json_file(folder, file_id):
    """מחיקת קובץ JSON"""
    filepath = os.path.join(folder, f"{file_id}.json")
    if os.path.exists(filepath):
        os.remove(filepath)
        return True
    return False

# --- מנגנון התראות Webhook ---
def notify_receivers(event_type, payload=None):
    """שולח הודעת Webhook לכל הרסיברים."""
    if payload is None:
        payload = {}
        
    payload['type'] = event_type
    
    for url in RECEIVER_URLS:
        try:
            logging.info(f"שולח Webhook ל-{url} על אירוע {event_type}...")
            # משתמש ב-timeout כדי לא להיתקע אם רסיבר אחד לא זמין
            response = requests.post(url, json=payload, timeout=5) 
            response.raise_for_status() 
            logging.info(f"Webhook נשלח בהצלחה ל-{url}. תגובה: {response.status_code}")
        except requests.exceptions.RequestException as e:
            logging.error(f"שגיאה בשליחת Webhook ל-{url} ({event_type}): {e}")

# --- API קוד Flask ---
@app.route('/api/data', methods=['GET'])
def api_get_all_data():
    """נקודת קצה למשיכת כל נתוני השירים והאירועים (משמש את הרסיברים)."""
    songs = list_json_files(SONGS_FOLDER)
    events = list_json_files(EVENTS_FOLDER)
    return jsonify({'songs': songs, 'events': events}), 200

@app.route('/api/songs', methods=['POST'])
def api_save_song():
    try:
        metadata_str = request.form.get('metadata')
        if not metadata_str: return jsonify({'error': 'Missing song metadata'}), 400
        metadata = json.loads(metadata_str)
        file = request.files.get('file')
        is_edit_mode = 'id' in metadata
        existing_song = get_item_by_id(SONGS_FOLDER, metadata['id']) if is_edit_mode else None

        if file and file.filename and file.filename != 'no_change.txt':
            if is_edit_mode and existing_song and existing_song.get('filename'):
                 old_file_path = os.path.join(SONGS_FOLDER, existing_song['filename'])
                 if os.path.exists(old_file_path): os.remove(old_file_path)
                     
            unique_filename = upload_and_save_file(file, SONGS_FOLDER, file.filename)
            metadata['filename'] = unique_filename
            metadata['url'] = f'/api/song_file/{unique_filename}'
        elif is_edit_mode and existing_song:
            metadata['filename'] = existing_song.get('filename')
            metadata['url'] = existing_song.get('url')
        elif not is_edit_mode and not file:
             return jsonify({'error': 'New song requires a file'}), 400

        song_data = save_json_file(SONGS_FOLDER, metadata, metadata.get('id'))
        
        # 🔔 שליחת התראת Webhook על עדכון שירים
        notify_receivers('songs_update', {'songId': song_data['id']}) 
        
        return jsonify(song_data), 200
        
    except Exception as e:
        logging.error(f"שגיאה בשמירת שיר: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/api/song/<song_id>', methods=['DELETE'])
def api_delete_song(song_id):
    song_to_delete = get_item_by_id(SONGS_FOLDER, song_id)
    if song_to_delete:
        delete_json_file(SONGS_FOLDER, song_id)
        audio_filename = song_to_delete.get('filename')
        if audio_filename:
            audio_filepath = os.path.join(SONGS_FOLDER, audio_filename)
            if os.path.exists(audio_filepath): os.remove(audio_filepath)
            
        # 🔔 שליחת התראת Webhook על מחיקת שיר
        notify_receivers('songs_update', {'deletedSongId': song_id})
        
        return jsonify({'message': 'Song deleted'}), 200
    return jsonify({'error': 'Song not found'}), 404
    
@app.route('/api/song_file/<filename>', methods=['GET'])
def api_get_song_file(filename):
    """מאפשר לרסיברים למשוך קבצי אודיו (שירים או קריאות פאניק)."""
    # בדיקה בתיקיית השירים ובתיקיית הפאניק
    filepath = os.path.join(SONGS_FOLDER, filename)
    if os.path.exists(filepath): return send_file(filepath)
    
    filepath = os.path.join(PANIC_FOLDER, filename)
    if os.path.exists(filepath): return send_file(filepath)
    
    return jsonify({'error': 'File not found'}), 404

@app.route('/api/panic', methods=['POST'])
def api_handle_panic():
    try:
        file = request.files.get('file')
        if not file or not file.filename: return jsonify({'error': 'No audio file provided'}), 400
        
        unique_filename = upload_and_save_file(file, PANIC_FOLDER, file.filename)
        
        # 🚨 שליחת התראת Webhook מיידית - הרסיברים ימשכו וינגנו את הקובץ
        notify_receivers('panic_alert', {'filename': unique_filename})
        
        return jsonify({
            'message': 'Panic recording saved and broadcasted',
            'filename': unique_filename
        }), 200

    except Exception as e:
        logging.error(f"שגיאה בטיפול בקריאת פאניקה: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/api/event', methods=['POST'])
def api_create_event():
    data = request.json
    if not data.get('name') or not data.get('time') or not data.get('songId'):
        return jsonify({'error': 'Missing required fields'}), 400
    event = save_json_file(EVENTS_FOLDER, data)
    
    # 🔔 שליחת התראת Webhook על עדכון אירועים
    notify_receivers('events_update', {'eventId': event['id']})
    
    return jsonify(event), 201

@app.route('/api/event/<event_id>', methods=['PUT'])
def api_update_event(event_id):
    data = request.json
    if not data.get('name') or not data.get('time') or not data.get('songId'):
        return jsonify({'error': 'Missing required fields'}), 400
        
    data['id'] = event_id
    event = save_json_file(EVENTS_FOLDER, data, event_id)
    
    # 🔔 שליחת התראת Webhook על עדכון אירועים
    notify_receivers('events_update', {'eventId': event['id']})
    
    return jsonify(event), 200

@app.route('/api/event/<event_id>', methods=['DELETE'])
def api_delete_event(event_id):
    if delete_json_file(EVENTS_FOLDER, event_id):
        
        # 🔔 שליחת התראת Webhook על עדכון אירועים
        notify_receivers('events_update', {'deletedEventId': event_id})
        
        return jsonify({'message': 'Event deleted'}), 200
    return jsonify({'error': 'Event not found'}), 404

@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    port = int(os.environ.get("PORT", 8000))
   socketio.run(host='0.0.0.0', port=port, debug=True, use_reloader=True)
