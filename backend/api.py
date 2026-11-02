import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
from scanner import perform_on_demand_scan, generate_ai_reply

try:
    if os.path.exists('serviceAccountKey.json'):
        cred = credentials.Certificate('serviceAccountKey.json')
    else:
        cred = None

    if cred:
        firebase_admin.initialize_app(cred)
        db = firestore.client()
    else:
        db = None
except Exception as e:
    db = None

app = Flask(__name__)
CORS(app)

@app.route('/add-monitor', methods=['POST'])
def add_monitor():
    if not db:
        return jsonify({"status": "error", "message": "Database not initialized."}), 500

    try:
        data = request.get_json()

        if not data or 'userId' not in data or 'productName' not in data or 'keywords' not in data:
            return jsonify({"status": "error", "message": "Missing required data"}), 400

        userId = data['userId']
        monitor_data = {
            'productName': data['productName'],
            'keywords': data['keywords'],
            'createdAt': firestore.SERVER_TIMESTAMP
        }

        db.collection('users').document(userId).collection('monitors').add(monitor_data)

        return jsonify({"status": "success", "message": "Monitor added successfully!"}), 201

    except Exception as e:
        return jsonify({"status": "error", "message": "Internal server error."}), 500

@app.route('/scan', methods=['POST'])
def scan_subreddit():
    if not db:
        return jsonify({"status": "error", "message": "Database not initialized."}), 500

    try:
        data = request.get_json()

        subreddit = data.get('subreddit')
        post_limit = data.get('postLimit')
        user_id = data.get('userId')

        if not all([subreddit, post_limit, user_id]):
            return jsonify({"status": "error", "message": "Missing required parameters"}), 400
        
        leads = perform_on_demand_scan(subreddit_name=subreddit, post_limit=post_limit, user_id=user_id)

        return jsonify({"status": "success", "leads": leads}), 200

    except Exception as e:
        return jsonify({"status": "error", "message": "Internal server error."}), 500

@app.route('/generate-reply', methods=['POST'])
def get_ai_reply():
    try:
        data = request.get_json()

        lead_text = data.get('lead_text')
        user_id = data.get('userId')

        if not lead_text or not user_id:
            return jsonify({"status": "error", "message": "Missing required parameters"}), 400

        ai_reply = generate_ai_reply(lead_text=lead_text, user_id=user_id)

        return jsonify({"reply": ai_reply}), 200

    except Exception as e:
        return jsonify({"status": "error", "message": "Internal server error."}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=4000, debug=True)
