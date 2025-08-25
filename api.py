# api.py
from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin
from firebase_admin import credentials, firestore
# 1. IMPORT THE NEW FUNCTION
from scanner import perform_on_demand_scan, generate_ai_reply

# --- إعداد Firebase ---
# Initialize Firebase Admin SDK
try:
    # It's recommended to use environment variables for credentials in production
    cred = credentials.Certificate('serviceAccountKey.json')
    firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✅ Successfully connected to Firebase")
except Exception as e:
    print(f"❌ Firebase Connection Error: {e}")
    # Set db to None if connection fails, so routes can handle the error gracefully
    db = None

# --- إعداد Flask ---
# Initialize the Flask application
app = Flask(__name__)

# --- تفعيل CORS بطريقة احترافية ---
# Using a permissive CORS configuration for local development.
# This will allow requests from any origin.
CORS(app)

# --- Route رئيسي لإضافة monitor ---
# The route now only needs to handle POST requests.
# The OPTIONS preflight request is handled automatically by Flask-CORS.
@app.route('/add-monitor', methods=['POST'])
def add_monitor():
    # Check if the database connection was successful
    if not db:
        return jsonify({"status": "error", "message": "Database not initialized. Check server logs."}), 500

    try:
        # Get the JSON data from the request body
        data = request.get_json()

        # Validate that all required data is present
        if not data or 'userId' not in data or 'productName' not in data or 'keywords' not in data:
            return jsonify({"status": "error", "message": "Missing required data in request body"}), 400

        # Prepare the data to be saved to Firestore
        userId = data['userId']
        monitor_data = {
            'productName': data['productName'],
            'keywords': data['keywords'],
            'createdAt': firestore.SERVER_TIMESTAMP  # Use server-side timestamp
        }

        # Add the new monitor document to the user's 'monitors' subcollection
        db.collection('users').document(userId).collection('monitors').add(monitor_data)

        # Return a success response
        return jsonify({"status": "success", "message": "Monitor added successfully!"}), 201

    except Exception as e:
        # Log the full error for debugging purposes
        print(f"❌ An error occurred in /add-monitor: {e}")
        # Return a generic error message to the client
        return jsonify({"status": "error", "message": "An internal server error occurred."}), 500

# --- NEW ROUTE FOR ON-DEMAND SCAN ---
@app.route('/scan', methods=['POST'])
def scan_subreddit():
    """
    Triggers an on-demand scan of a subreddit for a specific user.
    """
    if not db:
        return jsonify({"status": "error", "message": "Database not initialized. Check server logs."}), 500

    try:
        data = request.get_json()

        # Extract parameters and validate
        subreddit = data.get('subreddit')
        post_limit = data.get('postLimit')
        user_id = data.get('userId')

        if not all([subreddit, post_limit, user_id]):
            return jsonify({"status": "error", "message": "Missing required parameters: subreddit, postLimit, and userId"}), 400
        
        # Call the scanning function from the bot module
        leads = perform_on_demand_scan(subreddit_name=subreddit, post_limit=post_limit, user_id=user_id)

        # Return the results successfully
        return jsonify({"status": "success", "leads": leads}), 200

    except Exception as e:
        print(f"❌ An error occurred in /scan: {e}")
        return jsonify({"status": "error", "message": "An internal server error occurred."}), 500

# 2. CREATE A NEW FLASK ROUTE
@app.route('/generate-reply', methods=['POST'])
def get_ai_reply():
    """
    Generates an AI-powered reply based on the provided lead text.
    """
    # 4. ERROR HANDLING
    try:
        # 3. IMPLEMENT ENDPOINT LOGIC
        data = request.get_json()

        # Extract parameters and validate their presence
        lead_text = data.get('lead_text')
        user_id = data.get('userId')

        if not lead_text or not user_id:
            return jsonify({"status": "error", "message": "Missing required parameters: lead_text and userId"}), 400

        # Call the imported function to generate the AI reply
        ai_reply = generate_ai_reply(lead_text=lead_text, user_id=user_id)

        # Return the generated reply in the specified JSON format
        return jsonify({"reply": ai_reply}), 200

    except Exception as e:
        # Log the error for debugging
        print(f"❌ An error occurred in /generate-reply: {e}")
        # Return a generic server error message
        return jsonify({"status": "error", "message": "An internal server error occurred."}), 500

# --- تشغيل السيرفر ---
# Run the Flask app
if __name__ == '__main__':
    # Use debug=False in a production environment
    app.run(host='0.0.0.0', port=4000, debug=True)
