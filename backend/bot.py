# -*- coding: utf-8 -*-
"""
Xlead - Backend Monitoring Engine
Version: 2.3.1
Author: Senior Backend Developer

This script has been upgraded to use dynamic, user-specific prompts for the 
Google Gemini API, leveraging business profiles stored in Firestore for 
highly personalized lead analysis. This version includes enhanced diagnostic logging.
"""

import os
import time
import threading
import logging
import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
import urllib.request
from PIL import Image
import io


# --- Core Libraries ---
import praw
import tweepy
import telegram
from telegram.ext import Updater, CommandHandler
from telegram.constants import ParseMode
from googleapiclient.discovery import build
from bs4 import BeautifulSoup
import requests

# --- Firebase Admin SDK Integration ---
import firebase_admin
from firebase_admin import credentials, firestore

# --- Google Gemini API Integration ---
import google.generativeai as genai

# --- Logging Configuration ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(threadName)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

# --- API Credentials ---
FIREBASE_SERVICE_ACCOUNT_KEY = 'serviceAccountKey.json'
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyDJOWwt8annxisIumfCN8XNO9LhnvcqwQo") 
REDDIT_CLIENT_ID = os.environ.get("REDDIT_CLIENT_ID", "Pe0eg9fIqiHt_URagBM_uw")
REDDIT_CLIENT_SECRET = os.environ.get("REDDIT_CLIENT_SECRET", "zVqrTuQ3Ls584T2PG1YdAQl1EO2ZnA")
REDDIT_USER_AGENT = os.environ.get("REDDIT_USER_AGENT", "SignalStreamBot/1.0 by Xleads")
REDDIT_USERNAME = os.environ.get("REDDIT_USERNAME", "Xleads")
REDDIT_PASSWORD = os.environ.get("REDDIT_PASSWORD", "QWBZAF8A")
TWITTER_BEARER_TOKEN = os.environ.get("TWITTER_BEARER_TOKEN", "YOUR_TWITTER_BEARER_TOKEN")
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "AIzaSyCVamNK42BwigNZggDzuVfDEh3mmwFCMzk")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "7612153739:AAEAxWTT4N903pgIpesqUF0m2iFwb1up4tc")

# --- Configure Gemini API ---
try:
    genai.configure(api_key=GEMINI_API_KEY)
    logging.info("Google Gemini API configured successfully.")
except Exception as e:
    logging.critical(f"FATAL: Failed to configure Gemini API: {e}")
    exit()


# --- Global State Management ---
PROCESSED_ITEM_IDS = set()
main_loop = None

# --- Shared State for Dynamic Updates ---
class MonitorState:
    def __init__(self):
        self._keyword_map = {}
        self._lock = threading.Lock()

    def get_map(self):
        with self._lock:
            return self._keyword_map.copy()

    def update_map(self, new_map):
        with self._lock:
            if self._keyword_map != new_map:
                self._keyword_map = new_map
                logging.info(f"Monitor state updated with {len(new_map)} keywords.")
            else:
                logging.info("Monitor state checked, no changes detected.")

# --- 1. Firebase Integration ---
def get_all_monitors_from_firestore():
    """
    Fetches all user monitors from Firestore and maps keywords to user data.
    Includes robust error handling for the entire fetch operation.
    """
    logging.info("Attempting to fetch all monitors from Firestore...")
    db = firestore.client()
    keyword_to_users_map = {}
    try:
        # The entire data fetching process is wrapped in a single try block.
        users_ref = db.collection('users')
        for user_doc in users_ref.stream():
            user_id = user_doc.id
            user_data = user_doc.to_dict()
            if not user_data or not user_data.get('telegramChatId'):
                logging.warning(f"User {user_id} is missing 'telegramChatId'. Skipping.")
                continue
            
            monitors_ref = user_doc.reference.collection('monitors')
            for monitor_doc in monitors_ref.stream():
                monitor_data = monitor_doc.to_dict()
                if monitor_data and 'keywords' in monitor_data and 'productName' in monitor_data:
                    keywords_value = monitor_data['keywords']
                    keywords_list = [k.strip() for k in keywords_value.split(',')] if isinstance(keywords_value, str) else keywords_value
                    
                    user_info = {
                        'user_id': user_id, 
                        'telegram_chat_id': user_data['telegramChatId'], 
                        'monitor_data': monitor_data,
                        'business_profile': user_data.get('business_profile', {}) # Include business profile
                    }
                    
                    for keyword in keywords_list:
                        standardized_keyword = keyword.lower().strip()
                        if standardized_keyword:
                            if standardized_keyword not in keyword_to_users_map:
                                keyword_to_users_map[standardized_keyword] = []
                            keyword_to_users_map[standardized_keyword].append(user_info)
                            
    except Exception as e:
        # This except block now correctly follows the try block.
        logging.critical(f"FATAL: Error fetching from Firestore: {e}", exc_info=True)
        return {}

    # These lines are now outside the try...except block and will only run on success.
    logging.info(f"Firestore fetch complete. Found {len(keyword_to_users_map)} unique keywords.")
    return keyword_to_users_map

# --- NEW: Helper to fetch a single user's profile ---
def get_user_profile(user_id: str):
    """Fetches the business_profile for a given user ID."""
    try:
        db = firestore.client()
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()
        if user_doc.exists:
            user_data = user_doc.to_dict()
            return user_data.get('business_profile')
        else:
            logging.warning(f"No document found for user_id: {user_id}")
            return None
    except Exception as e:
        logging.error(f"Error fetching profile for user {user_id}: {e}")
        return None

# --- Helper to fetch full user details (for on-demand scan) ---
def get_user_details(user_id: str):
    """Fetches the full user document for a given user ID."""
    try:
        db = firestore.client()
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()
        if user_doc.exists:
            return user_doc.to_dict()
        else:
            logging.warning(f"No document found for user_id: {user_id}")
            return None
    except Exception as e:
        logging.error(f"Error fetching details for user {user_id}: {e}")
        return None


# --- 2. UPGRADED: Gemini AI Lead Analysis Engine ---
def analyze_lead_with_gemini(text: str, user_id: str):
    """
    Analyzes lead text using the Gemini API with a dynamic, user-specific prompt.
    Falls back to a generic prompt if the user profile is unavailable.
    """
    model = genai.GenerativeModel('gemini-1.5-flash-latest')
    business_profile = get_user_profile(user_id)
    
    # REQUIREMENT 1: Log Profile Fetch
    logging.info(f"Successfully fetched business profile for user {user_id}: {business_profile}")

    # --- Dynamic Prompt Generation ---
    if business_profile and all(k in business_profile for k in ['product_description', 'ideal_customer', 'customer_problems']):
        # REQUIREMENT 2: Log Prompt Type (Dynamic)
        logging.info("User has a business profile. Generating dynamic prompt...")
        prompt = f"""
        You are an expert sales analyst for a company that provides: '{business_profile['product_description']}'.
        Their ideal customer is a '{business_profile['ideal_customer']}' who commonly struggles with '{business_profile['customer_problems']}'.

        Analyze the following user-generated text to determine if it's a good sales lead for this specific company.
        Your response MUST be a single, raw JSON object with the following exact schema and no other text, explanations, or markdown.

        JSON Schema:
        {{
          "summary": "A one-sentence summary of the user's core need, tailored to why it's relevant for the company.",
          "pain_points": ["A list of specific problems mentioned that align with what the company solves."],
          "intent_score": "A score from 1 (low relevance) to 10 (perfect match, urgent need).",
          "mentioned_competitors": ["A list of any competitor products mentioned."],
          "customer_persona": "A brief description of the user profile, e.g., 'Small business owner', 'Independent developer'."
        }}

        User Text:
        ---
        {text}
        ---

        Your JSON response:
        """
    else:
        # --- Fallback Generic Prompt ---
        # REQUIREMENT 2: Log Prompt Type (Fallback)
        logging.info("User profile not found or incomplete. Falling back to generic prompt.")
        prompt = f"""
        Analyze the following user-generated text to identify a potential sales lead.
        Based on the text, provide a structured analysis. Your response MUST be a single,
        raw JSON object with the following exact schema and no other text, explanations, or markdown.

        JSON Schema:
        {{
          "summary": "A one-sentence summary of the user's core need or problem.",
          "pain_points": ["A list of specific problems or difficulties the user mentioned."],
          "intent_score": "A score from 1 (curiosity) to 10 (urgent buying need).",
          "mentioned_competitors": ["A list of any competitor products mentioned by the user."],
          "customer_persona": "A brief description of the user profile, e.g., 'Small business owner', 'Independent developer', 'Student'."
        }}

        User Text:
        ---
        {text}
        ---

        Your JSON response:
        """
    
    try:
        # REQUIREMENT 3: Log The Final Prompt
        logging.info(f"Final prompt sent to Gemini: {prompt}")
        
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json"
            )
        )
        
        analysis_json = json.loads(response.text)
        
        # REQUIREMENT 4: Log Before Saving
        logging.info(f"Gemini analysis successful for user {user_id}. Preparing to save to Firestore.")
        return analysis_json

    except Exception as e:
        logging.error(f"Error during Gemini API call for user {user_id}: {e}", exc_info=True)
        return None

# --- UPGRADED: Gemini Vision Analysis Engine ---
def analyze_image_lead_with_gemini(image_url: str, user_id: str):
    """
    Analyzes an image from a URL using a dynamic, user-specific prompt.
    Falls back to a generic prompt if the user profile is unavailable.
    """
    model = genai.GenerativeModel('gemini-1.5-flash-latest')
    business_profile = get_user_profile(user_id)

    # REQUIREMENT 1: Log Profile Fetch
    logging.info(f"Successfully fetched business profile for user {user_id}: {business_profile}")

    # --- Dynamic Prompt Generation ---
    if business_profile and all(k in business_profile for k in ['product_description', 'ideal_customer', 'customer_problems']):
        # REQUIREMENT 2: Log Prompt Type (Dynamic)
        logging.info("User has a business profile. Generating dynamic prompt...")
        prompt = f"""
        Act as an expert sales opportunity analyst for a company that provides: '{business_profile['product_description']}'.
        Their ideal customer is a '{business_profile['ideal_customer']}' who struggles with '{business_profile['customer_problems']}'.
        
        Analyze the attached image to identify problems or opportunities that this specific company could solve.
        For example, if they sell cable organizers, look for messy cables. If they sell ergonomic chairs, look for poor posture or bad setups.
        Provide your analysis in a structured JSON format. Your response MUST be a single, raw JSON object.

        JSON Schema:
        {{
          "summary": "A one-sentence summary of the core opportunity visible in the image, relevant to the company.",
          "pain_points": ["A list of specific problems observed that the company's product can solve."],
          "intent_score": "A score from 1 (low relevance) to 10 (clear, urgent problem visible).",
          "mentioned_competitors": [],
          "customer_persona": "A brief description of the user profile based on the environment, e.g., 'Creative professional', 'Gaming enthusiast'."
        }}
        """
    else:
        # --- Fallback Generic Prompt ---
        # REQUIREMENT 2: Log Prompt Type (Fallback)
        logging.info("User profile not found or incomplete. Falling back to generic prompt.")
        prompt = """
        Act as an expert sales opportunity analyst. Analyze the attached image and identify any problems, needs, or opportunities that could be solved by a product. For example, look for messy cables, poor ergonomics, clutter, outdated equipment, or anything the user might want to improve. Provide your analysis in a structured JSON format.

        Your response MUST be a single, raw JSON object with the following exact schema and no other text, explanations, or markdown.

        JSON Schema:
        {
          "summary": "A one-sentence summary of the core opportunity or problem visible in the image.",
          "pain_points": ["A list of specific problems or potential difficulties observed, like 'Cable management needed' or 'Outdated monitor'."],
          "intent_score": "A score from 1 (no clear need) to 10 (urgent problem visible).",
          "mentioned_competitors": [],
          "customer_persona": "A brief description of the user profile based on the environment, e.g., 'Creative professional', 'Gaming enthusiast', 'Remote worker'."
        }
        """
    
    try:
        # REQUIREMENT 3: Log The Final Prompt
        logging.info(f"Final prompt sent to Gemini: {prompt}")

        logging.info(f"Downloading image for analysis: {image_url}")
        with urllib.request.urlopen(image_url) as response:
            image_data = response.read()
        
        image = Image.open(io.BytesIO(image_data))

        response = model.generate_content(
            [prompt, image],
            generation_config=genai.types.GenerationConfig(
                response_mime_type="application/json"
            )
        )
        
        analysis_json = json.loads(response.text)
        
        # REQUIREMENT 4: Log Before Saving
        logging.info(f"Gemini analysis successful for user {user_id}. Preparing to save to Firestore.")
        return analysis_json

    except Exception as e:
        logging.error(f"Error during Gemini Vision API call for {image_url} (user {user_id}): {e}", exc_info=True)
        return None


def escape_markdown_v2(text: str) -> str:
    """
    Escapes characters for Telegram's MarkdownV2 format.
    """
    if not isinstance(text, str):
        text = str(text)
    escape_chars = r'_*[]()~`>#+-=|{}.!'
    return re.sub(f'([{re.escape(escape_chars)}])', r'\\\1', text)

# --- 3. Telegram Notification Logic (Unchanged) ---
async def send_telegram_alert(chat_id, platform, keyword, analysis, snippet, url):
    """
    Asynchronously sends a detailed, well-formatted alert using Gemini analysis data.
    """
    platform_icons = {'Reddit': '🤖', 'X (Twitter)': '🐦', 'YouTube': '📺', 'Web': '🌐', 'Image': '🖼️'}
    icon = platform_icons.get(platform, '❓')
    
    summary = analysis.get('summary', 'N/A')
    try:
        intent_score = int(analysis.get('intent_score', 0))
    except (ValueError, TypeError):
        intent_score = 0
        
    pain_points = analysis.get('pain_points', [])
    persona = analysis.get('customer_persona', 'N/A')

    intent_bar = '🔥' * intent_score + '⚪️' * (10 - intent_score)
    
    if pain_points and isinstance(pain_points, list):
        pain_points_text = "\n".join([f"• _{escape_markdown_v2(p)}_" for p in pain_points])
    else:
        pain_points_text = "_No specific pain points identified\\._"

    escaped_summary = escape_markdown_v2(summary)
    escaped_persona = escape_markdown_v2(persona)
    escaped_platform = escape_markdown_v2(platform)
    product_display_name = escape_markdown_v2(keyword.capitalize())

    message = (
        f"{icon} *New Lead Found on {escaped_platform}* {icon}\n\n"
        f"🎯 *Matched Keyword:* `{product_display_name}`\n\n"
        f"💡 *AI Summary:*\n_{escaped_summary}_\n\n"
        f"� *Buying Intent: {intent_score}/10*\n`{intent_bar}`\n\n"
        f"👤 *Customer Persona:*\n`{escaped_persona}`\n\n"
        f" *User's Pain Points:*\n{pain_points_text}\n\n"
        f"🔗 *Direct Link:*\n[Click here to view the source]({url})"
    )
    
    try:
        bot = telegram.Bot(token=TELEGRAM_BOT_TOKEN)
        await bot.send_message(
            chat_id=chat_id, 
            text=message, 
            parse_mode=ParseMode.MARKDOWN_V2,
            disable_web_page_preview=False
        )
    except Exception as e:
        logging.error(f"Failed to send Telegram alert to {chat_id}: {e}")

def send_telegram_alert_sync(chat_id, platform, keyword, analysis, snippet, url):
    """Wrapper to safely call the async alert function from a sync thread."""
    if main_loop and main_loop.is_running():
        asyncio.run_coroutine_threadsafe(
            send_telegram_alert(chat_id, platform, keyword, analysis, snippet, url),
            main_loop
        )

# --- 4. UPGRADED: Core Item Processing Logic ---
def process_found_item(item_id, text, url, platform, monitor_state):
    if item_id in PROCESSED_ITEM_IDS:
        return
    
    keyword_map = monitor_state.get_map()
    if not keyword_map:
        return

    PROCESSED_ITEM_IDS.add(item_id)
    text_lower = text.lower()

    for keyword, users in keyword_map.items():
        if re.search(r'\b' + re.escape(keyword) + r'\b', text_lower):
            # A keyword matched, now process for each subscribed user
            for user_info in users:
                user_id = user_info['user_id']
                
                # Perform analysis with Gemini using the specific user's ID for context
                analysis_data = analyze_lead_with_gemini(text, user_id)
                
                if not analysis_data:
                    logging.warning(f"Skipping lead {item_id} for user {user_id} due to analysis failure.")
                    continue

                snippet = text.strip()
                if len(snippet) > 200:
                    snippet = snippet[:200] + "..."

                logging.info(f"MATCH! Keyword: '{keyword}', User: {user_id}, Intent: {analysis_data.get('intent_score', 'N/A')}")

                product_name = user_info['monitor_data'].get('productName', keyword)
                
                send_telegram_alert_sync(
                    chat_id=user_info['telegram_chat_id'],
                    platform=platform, 
                    keyword=product_name,
                    analysis=analysis_data,
                    snippet=snippet, 
                    url=url
                )

                # Save lead to Firestore with detailed analysis
                try:
                    db = firestore.client()
                    lead_data = {
                        'userId': user_id,
                        'source': platform,
                        'source_type': 'Text',
                        'keyword': keyword,
                        'text': text,
                        'url': url,
                        'analysis': analysis_data,
                        'timestamp': firestore.SERVER_TIMESTAMP
                    }
                    db.collection('leads').add(lead_data)
                    logging.info(f"Successfully saved lead for user {user_id} to Firestore.")
                except Exception as e:
                    logging.error(f"Failed to save lead to Firestore for user {user_id}: {e}")

# --- 5. Monitoring Source Functions (Reddit Text Unchanged) ---
def monitor_reddit(monitor_state):
    logging.info("Initializing Reddit monitor...")
    try:
        reddit = praw.Reddit(client_id=REDDIT_CLIENT_ID, client_secret=REDDIT_CLIENT_SECRET, user_agent=REDDIT_USER_AGENT, username=REDDIT_USERNAME, password=REDDIT_PASSWORD)
        subreddit = reddit.subreddit("all")
        comment_thread = threading.Thread(target=stream_reddit_comments, args=(subreddit, monitor_state), daemon=True)
        submission_thread = threading.Thread(target=stream_reddit_submissions, args=(subreddit, monitor_state), daemon=True)
        comment_thread.start()
        submission_thread.start()
        logging.info("Reddit monitor is now streaming.")
    except Exception as e:
        logging.error(f"Reddit monitor failed: {e}", exc_info=True)

def stream_reddit_comments(subreddit, monitor_state):
    while True:
        try:
            for comment in subreddit.stream.comments(skip_existing=True):
                process_found_item(f"rc_{comment.id}", comment.body, f"https://www.reddit.com{comment.permalink}", "Reddit", monitor_state)
                time.sleep(1)
        except Exception as e:
            logging.error(f"Error in Reddit comment stream: {e}. Reconnecting in 60s.")
            time.sleep(60)

def stream_reddit_submissions(subreddit, monitor_state):
    while True:
        try:
            for submission in subreddit.stream.submissions(skip_existing=True):
                process_found_item(f"rs_{submission.id}", f"{submission.title} {submission.selftext}", submission.url, "Reddit", monitor_state)
                time.sleep(1)
        except Exception as e:
            logging.error(f"Error in Reddit submission stream: {e}. Reconnecting in 60s.")
            time.sleep(60)

# --- UPGRADED: Visual Opportunity Search Monitor ---
def monitor_reddit_images(monitor_state):
    """Monitors specific subreddits for images and analyzes them for each user with a profile."""
    logging.info("Initializing Reddit Image monitor...")
    try:
        reddit = praw.Reddit(client_id=REDDIT_CLIENT_ID, client_secret=REDDIT_CLIENT_SECRET, user_agent=REDDIT_USER_AGENT)
        subreddit = reddit.subreddit("battlestations+macsetups+homelab+organization")
        logging.info(f"Reddit Image monitor is now streaming from: {subreddit.display_name}")
        time.sleep(1)
    except Exception as e:
        logging.error(f"Failed to initialize Reddit instance for Image monitor: {e}", exc_info=True)
        return

    while True:
        try:
            for submission in subreddit.stream.submissions(skip_existing=True):
                if submission.id in PROCESSED_ITEM_IDS:
                    continue

                if submission.url.lower().endswith(('.jpg', '.jpeg', '.png')):
                    logging.info(f"New image post found: {submission.title} ({submission.url})")
                    PROCESSED_ITEM_IDS.add(submission.id)

                    # Get all users who might be interested
                    keyword_map = monitor_state.get_map()
                    processed_users = set()
                    all_users = [user for user_list in keyword_map.values() for user in user_list]

                    for user_info in all_users:
                        user_id = user_info['user_id']
                        if user_id in processed_users:
                            continue
                        processed_users.add(user_id)
                        
                        # Only analyze for users who have a business profile
                        if user_info.get('business_profile'):
                            analysis_data = analyze_image_lead_with_gemini(submission.url, user_id)
                            
                            if not analysis_data:
                                logging.warning(f"Skipping image lead {submission.id} for user {user_id} due to analysis failure.")
                                continue
                            
                            # Send alert and save lead for this specific user
                            send_telegram_alert_sync(
                                chat_id=user_info['telegram_chat_id'],
                                platform="Image",
                                keyword="Visual Opportunity", # Generic keyword for image leads
                                analysis=analysis_data,
                                snippet=submission.title,
                                url=f"https://www.reddit.com{submission.permalink}"
                            )

                            try:
                                db = firestore.client()
                                lead_data = {
                                    'userId': user_id,
                                    'source': 'Reddit',
                                    'source_type': 'Image',
                                    'keyword': None,
                                    'text': submission.title,
                                    'url': f"https://www.reddit.com{submission.permalink}",
                                    'image_url': submission.url,
                                    'analysis': analysis_data,
                                    'timestamp': firestore.SERVER_TIMESTAMP
                                }
                                db.collection('leads').add(lead_data)
                                logging.info(f"Successfully saved IMAGE lead {submission.id} for user {user_id} to Firestore.")
                            except Exception as e:
                                logging.error(f"Failed to save IMAGE lead {submission.id} for user {user_id} to Firestore: {e}")
        except Exception as e:
            logging.error(f"Error in Reddit image stream: {e}. Reconnecting in 60s.")
            time.sleep(60)


def monitor_youtube(monitor_state):
    logging.info("Initializing YouTube monitor...")
    try:
        youtube = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY)
    except Exception as e:
        logging.error(f"Failed to build YouTube service: {e}")
        return

    while True:
        keyword_map = monitor_state.get_map()
        if not keyword_map:
            time.sleep(300)
            continue
        
        for keyword in keyword_map.keys():
            try:
                published_after = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
                search_response = youtube.search().list(q=keyword, part='snippet', type='video', order='date', maxResults=5, publishedAfter=published_after).execute()
                for item in search_response.get('items', []):
                    video_id = item['id']['videoId']
                    process_found_item(f"ytv_{video_id}", f"{item['snippet']['title']} {item['snippet']['description']}", f"https://www.youtube.com/watch?v={video_id}", "YouTube", monitor_state)
            except Exception as e:
                logging.error(f"Error during YouTube search for '{keyword}': {e}")
            time.sleep(5)
        logging.info("YouTube monitor cycle complete. Sleeping for 15 minutes.")
        time.sleep(15 * 60)

# --- 6. Main Application Logic ---
def run_asyncio_loop(loop):
    asyncio.set_event_loop(loop)
    loop.run_forever()

def main():
    global main_loop
    logging.info("--- Xlead Backend Engine v2.3 (Dynamic Prompts Edition) Starting Up ---")

    try:
        if not firebase_admin._apps:
            cred = credentials.Certificate(FIREBASE_SERVICE_ACCOUNT_KEY)
            firebase_admin.initialize_app(cred)
            logging.info("Firebase app initialized successfully.")
    except Exception as e:
        logging.critical(f"FATAL: Failed to initialize Firebase: {e}", exc_info=True)
        return

    main_loop = asyncio.new_event_loop()
    asyncio_thread = threading.Thread(target=run_asyncio_loop, args=(main_loop,), name="AsyncioLoop", daemon=True)
    asyncio_thread.start()

    monitor_state = MonitorState()
    monitor_state.update_map(get_all_monitors_from_firestore())
    
    threads = [
        threading.Thread(target=monitor_reddit, args=(monitor_state,), name="RedditMonitor", daemon=True),
        threading.Thread(target=monitor_youtube, args=(monitor_state,), name="YouTubeMonitor", daemon=True),
        threading.Thread(target=monitor_reddit_images, args=(monitor_state,), name="RedditImageMonitor", daemon=True),
    ]
    
    for t in threads:
        t.start()

    logging.info("All monitoring threads have been started.")

    while True:
        try:
            time.sleep(3600)
            latest_map = get_all_monitors_from_firestore()
            monitor_state.update_map(latest_map)
        except Exception as e:
            logging.error(f"Error in main refresh loop: {e}", exc_info=True)
            time.sleep(300)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        logging.info("--- Xlead Backend Engine Shutting Down ---")
