from flask import Flask, jsonify, request, render_template, send_file
import os
import json
import logging
from werkzeug.utils import secure_filename
import uuid
from datetime import datetime
import threading
import time
import subprocess # לביצוע ניגון קבצים (mpg123)
import schedule   # לניהול לוח הזמנים

# --- הגדרות ---
app = Flask(__name__, template_folder='templates', static_folder='static')
app.config['UPLOAD_FOLDER'] = 'storage'

# תיקיות אחסון
EVENTS_FOLDER = os.path.join(app.config['UPLOAD_FOLDER'], 'events')
SONGS_FOLDER = os.path.join(app.config['UPLOAD_FOLDER'], 'songs')
PANIC_FOLDER = os.path.join(app.config['UPLOAD_FOLDER'], 'panic')

# קובץ מעקב: מאחסן את קובצי הפאניק שכבר נוגנו
PLAYED_PANIC_FILE = os.path.join(app.config['UPLOAD_FOLDER'], 'played_panic.txt')

os.makedirs(EVENTS_FOLDER, exist_ok=True)
os.makedirs(SONGS_FOLDER, exist_ok=True)
os.makedirs(PANIC_FOLDER, exist_ok=True)

# אם קובץ המעקב לא קיים, ניצור אותו
if not os.path.exists(PLAYED_PANIC_FILE):
    with open(PLAYED_PANIC_FILE, 'w') as f:
        f.write('')

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

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

# --- מנגנון הניגון הפיזי (על ה-Raspberry Pi) ---
def play_audio(file_path, start_time=None, end_time=None):
    """
    מנגן קובץ אודיו באמצעות mpg123.
    """
    if not os.path.exists(file_path):
        logging.error(f"קובץ ניגון לא נמצא: {file_path}")
        return False

    cmd = ['mpg123', file_path]
    
    logging.info(f"מנגן קובץ: {file_path} (פקודה: {' '.join(cmd)})")
    
    try:
        # הפעלה לא חוסמת, אלא אם נרצה לחכות לסיום הניגון
        subprocess.Popen(cmd)
        return True
    except FileNotFoundError:
        logging.critical("פקודת mpg123 לא נמצאה. ודא שהיא מותקנת.")
        return False
    except Exception as e:
        logging.error(f"שגיאה בהפעלת הניגון: {e}")
        return False

# --- ליסנר קריאה מיידית (פאניק) ---
# server.py

# ... (שאר הקוד נשאר זהה)

# --- ליסנר קריאה מיידית (פאניק) ---
def panic_listener_job():
    """בודק האם יש קבצי פאניק חדשים, מפעיל אותם, ומוחק אותם."""
    try:
        # 1. טען את רשימת הקבצים שנוגנו
        with open(PLAYED_PANIC_FILE, 'r') as f:
            played_files = set(f.read().splitlines())
        
        # 2. בדוק קבצים חדשים בתיקייה
        new_files = []
        for filename in os.listdir(PANIC_FOLDER):
            # מוודא שהקובץ הוא לא קובץ מעקב ושהוא עדיין לא נוגן
            if filename not in played_files and not filename.endswith('.txt'):
                new_files.append(filename)

        if new_files:
            logging.warning(f"נמצאו {len(new_files)} קריאות פאניק חדשות!")
            
            # מנגן את הקבצים (בסדר אלפביתי/זמן יצירה)
            new_files.sort()
            for filename in new_files:
                file_path = os.path.join(PANIC_FOLDER, filename)
                
                # ניגון עם המתנה לסיום (כדי שלא יתנגנו בו זמנית)
                logging.info(f"**מפעיל קריאת פאניק:** {filename}")
                
                # --- ניגון הקובץ (מחייב mpg123 להיות מותקן) ---
                try:
                    subprocess.run(['mpg123', file_path], check=True) # check=True יזרוק שגיאה אם mpg123 נכשל
                    
                    # 3. מחיקת הקובץ לאחר ניגון מוצלח
                    os.remove(file_path)
                    logging.info(f"קובץ פאניק נמחק לאחר ניגון: {filename}")
                    
                    # 4. אם נמחק, אין צורך לרשום אותו ב-played_panic.txt.
                    # אם הניגון נכשל (כי mpg123 לא נמצא), הקובץ יישאר בתיקייה.
                    
                except FileNotFoundError:
                    logging.critical("פקודת mpg123 לא נמצאה. ודא שהיא מותקנת. הקובץ לא נמחק.")
                except subprocess.CalledProcessError as e:
                     logging.error(f"שגיאת ניגון: {e}. הקובץ לא נמחק.")
                except Exception as e:
                    logging.error(f"שגיאה בלתי צפויה במהלך ניגון/מחיקה: {e}")

            logging.info("סיום טיפול בקריאות פאניק.")

    except Exception as e:
        logging.error(f"שגיאה בליסנר פאניק: {e}")


# --- תזמון אירועים קבוע (לוח זמנים) ---
def events_scheduler_job():
    """מפעיל אירועים מתוזמנים אם הגיע זמנם."""
    
    all_events = list_json_files(EVENTS_FOLDER)
    all_songs = list_json_files(SONGS_FOLDER)
    
    songs_map = {str(s['id']): s for s in all_songs}

    now = datetime.now()
    # שינוי קטן כדי לוודא התאמה לתוכנית: יום שני הוא 0, ראשון הוא 6.
    # [0:שני, 1:שלישי, 2:רביעי, 3:חמישי, 4:שישי, 5:שבת, 6:ראשון]
    days_map = ['שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'ראשון']
    current_day = days_map[now.weekday()]
    current_time = now.strftime('%H:%M')

    logging.debug(f"בודק אירועים: {current_day} {current_time}")

    for event in all_events:
        try:
            if event['day'] == current_day and event['time'] == current_time:
                
                song = songs_map.get(str(event['songId']))
                
                if not song:
                    logging.error(f"שיר ({event['songId']}) לא נמצא עבור אירוע: {event['name']}")
                    continue

                song_filename = song.get('filename')
                if not song_filename:
                    logging.error(f"שם קובץ חסר עבור שיר: {song['name']}")
                    continue

                file_path = os.path.join(SONGS_FOLDER, song_filename)
                
                logging.warning(f"**מפעיל צלצול מתוזמן:** {event['name']} ({file_path})")
                
                # הפעלת הניגון (הניגון המדויק תלוי ב-mpg123)
                play_audio(file_path)

        except Exception as e:
            logging.error(f"שגיאה בהפעלת אירוע {event.get('name', 'לא ידוע')}: {e}")

# --- מנהל הרקע ---
def run_schedule_continuously():
    """רץ ב-thread נפרד ומנהל את כל בדיקות הליסנר והתזמון."""
    while True:
        schedule.run_pending()
        time.sleep(1) # בדיקה כל שנייה

# הגדרת הג'ובים:
schedule.every(5).seconds.do(panic_listener_job)
schedule.every(1).minutes.do(events_scheduler_job)

# --- API קוד Flask ---
@app.route('/api/data', methods=['GET'])
def api_get_all_data():
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
        return jsonify({'message': 'Song deleted'}), 200
    return jsonify({'error': 'Song not found'}), 404
    
@app.route('/api/song_file/<filename>', methods=['GET'])
def api_get_song_file(filename):
    filepath = os.path.join(SONGS_FOLDER, filename)
    if os.path.exists(filepath): return send_file(filepath)
    return jsonify({'error': 'File not found'}), 404

@app.route('/api/panic', methods=['POST'])
def api_handle_panic():
    try:
        file = request.files.get('file')
        if not file or not file.filename: return jsonify({'error': 'No audio file provided'}), 400
        
        unique_filename = upload_and_save_file(file, PANIC_FOLDER, file.filename)
        
        logging.info(f"קריאת פאניקה נשמרה בנתיב: {os.path.join(PANIC_FOLDER, unique_filename)}")
        
        return jsonify({
            'message': 'Panic recording saved, listener will play soon',
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
    return jsonify(event), 201

@app.route('/api/event/<event_id>', methods=['PUT'])
def api_update_event(event_id):
    data = request.json
    if not data.get('name') or not data.get('time') or not data.get('songId'):
        return jsonify({'error': 'Missing required fields'}), 400
        
    data['id'] = event_id
    event = save_json_file(EVENTS_FOLDER, data, event_id)
    return jsonify(event), 200

@app.route('/api/event/<event_id>', methods=['DELETE'])
def api_delete_event(event_id):
    if delete_json_file(EVENTS_FOLDER, event_id):
        return jsonify({'message': 'Event deleted'}), 200
    return jsonify({'error': 'Event not found'}), 404

@app.route('/')
def index():
    return render_template('index.html')


if __name__ == '__main__':
    logging.info('מפעיל את מנהל הלו"ז והליסנרים בחוט נפרד...')
    
    t = threading.Thread(target=run_schedule_continuously)
    t.daemon = True
    t.start()
    
port = int(os.environ.get("PORT", 8000))
app.run(host='0.0.0.0', port=port, debug=True, use_reloader=False)
