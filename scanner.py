import logging
import time
import json
import os
import re
from datetime import datetime
import urllib.request
from PIL import Image
import io

import praw
import firebase_admin
from firebase_admin import credentials, firestore
import google.generativeai as genai

# --- Reddit Credentials with Fallbacks ---
REDDIT_CLIENT_ID = os.environ.get("REDDIT_CLIENT_ID", "Pe0eg9fIqiHt_URagBM_uw")
REDDIT_CLIENT_SECRET = os.environ.get("REDDIT_CLIENT_SECRET", "zVqrTuQ3Ls584T2PG1YdAQl1EO2ZnA")
# -------------------------------------------

def get_user_details_for_scan(user_id: str):
    """Fetches user details from Firestore for a scan."""
    try:
        db = firestore.client()
        user_ref = db.collection('users').document(user_id)
        user_doc = user_ref.get()
        if user_doc.exists:
            return user_doc.to_dict()
        return None
    except Exception as e:
        logging.error(f"Error fetching details for user {user_id}: {e}")
        return None

def analyze_text_for_scan(text: str, user_info: dict):
    """Analyzes text to identify a sales lead using Gemini and returns a JSON object."""
    model = genai.GenerativeModel('gemini-1.5-flash-latest')
    business_profile = user_info.get('business_profile')
    
    if business_profile:
        prompt = f"You are a sales analyst for a company that offers: '{business_profile.get('product_description', 'a service')}' to '{business_profile.get('ideal_customer', 'customers')}'. Analyze the following text for a sales lead. Respond ONLY with a valid JSON object based on the schema."
    else:
        prompt = "Analyze the following text for a sales lead. Respond ONLY with a valid JSON object based on the schema."
    
    try:
        full_prompt = f"""
        {prompt}
        JSON Schema:
        {{
          "summary": "A one-sentence summary of the user's core need.",
          "pain_points": ["A list of specific problems mentioned."],
          "intent_score": "A score from 1 to 10.",
          "mentioned_competitors": [],
          "customer_persona": "A brief description of the user profile."
        }}
        User Text: --- {text} ---
        Your JSON response:
        """
        response = model.generate_content(
            full_prompt,
            generation_config=genai.types.GenerationConfig(response_mime_type="application/json")
        )
        return json.loads(response.text)
    except Exception as e:
        logging.error(f"Error during Gemini text analysis in scan: {e}")
        return None

def perform_on_demand_scan(subreddit_name, post_limit, user_id):
    """Performs an on-demand scan of a subreddit for new leads."""
    logging.info(f"SCANNER: Starting scan for user '{user_id}' on 'r/{subreddit_name}' limit {post_limit}.")
    newly_found_leads = []
    db = firestore.client()

    try:
        if subreddit_name.lower().startswith('r/'):
            subreddit_name = subreddit_name[2:]

        user_details = get_user_details_for_scan(user_id)
        if not user_details:
            logging.error(f"SCANNER: Could not find user details for {user_id}. Aborting.")
            return []

        reddit = praw.Reddit(
            client_id=REDDIT_CLIENT_ID,
            client_secret=REDDIT_CLIENT_SECRET,
            user_agent="SignalStream_Scanner/1.0"
        )
        subreddit = reddit.subreddit(subreddit_name)

        for submission in subreddit.new(limit=post_limit):
            permalink = f"https://www.reddit.com{submission.permalink}"
            full_text = f"{submission.title} {submission.selftext}"
            
            analysis_result = analyze_text_for_scan(full_text, user_details)

            if analysis_result and isinstance(analysis_result, dict):
                lead_data = {
                    'userId': user_id, 'source': 'Reddit', 'source_type': 'Text',
                    'text': submission.title, 'url': permalink, 'analysis': analysis_result,
                    'timestamp': firestore.SERVER_TIMESTAMP, 'status': 'new'
                }
                db.collection('leads').add(lead_data)
                
                # Convert Firestore timestamp to a string for the JSON response
                lead_data['timestamp'] = str(datetime.now()) 
                newly_found_leads.append(lead_data)
                logging.info(f"SCANNER: Successfully processed and saved lead '{submission.id}'.")
            else:
                logging.warning(f"SCANNER: Analysis failed for submission '{submission.id}'. Skipping.")
            
            time.sleep(4)

        logging.info(f"SCANNER: Scan completed. Found {len(newly_found_leads)} leads.")
        return newly_found_leads

    except Exception as e:
        logging.error(f"SCANNER: A critical error occurred: {e}", exc_info=True)
        return []

def generate_ai_reply(lead_text: str, user_id: str) -> str:
    """
    Generates an AI-powered comment suggestion for a lead using the user's business profile.

    Args:
        lead_text: The text content of the lead (e.g., a Reddit post).
        user_id: The ID of the user to fetch the business profile for.

    Returns:
        A string containing the suggested comment, or an error message.
    """
    print("--- DEBUG: Entering generate_ai_reply function ---")
    try:
        logging.info(f"AI REPLY: Generating comment for user '{user_id}'.")
        user_details = get_user_details_for_scan(user_id)
        print(f"--- DEBUG: Fetched user_details: {user_details}")
        
        if not user_details:
            return "Error: Could not find user details to generate a reply."
            
        business_profile = user_details.get('business_profile')
        if business_profile:
            # This is the "dynamic" path, as it uses the user's profile.
            print("--- DEBUG: Generating DYNAMIC prompt.")
        else:
            # This path is not technically for a "generic" prompt, it's an error condition.
            # But we add the print here for completeness of debugging flow.
            print("--- DEBUG: Generating GENERIC prompt (Business Profile NOT FOUND).")
            return "Error: User has not configured their business profile."

        # Extract profile details with fallbacks
        product_desc = business_profile.get('product_description', 'our tool')
        ideal_customer = business_profile.get('ideal_customer', 'people')
        customer_problems = business_profile.get('customer_problems', 'their challenges')

        # Craft a specialized prompt for generating a high-quality, non-spammy comment
        prompt = f"""
        **Your Role:** You are an expert community member, acting as a helpful peer, NOT a salesperson.
        
        **Your Goal:** Write a short, engaging, and genuinely helpful Reddit comment in response to the user's post. Your comment should build rapport and trust.
        
        **Context about my business (for your information only, do not mention it directly):**
        - My Product: {product_desc}
        - My Ideal Customer: {ideal_customer}
        - Problems my product solves: {customer_problems}

        **The User's Post (Lead Text):**
        ---
        {lead_text}
        ---

        **Instructions for your comment:**
        1.  **Acknowledge, Don't Sell:** Start by acknowledging the user's problem or question. Show empathy.
        2.  **Offer Genuine Advice:** Provide a helpful tip or a perspective that is valuable on its own, even if they never use my product.
        3.  **Subtle Mention (Optional & Natural):** If, and only if, it feels completely natural, you can subtly mention how a tool could help with a specific part of their problem. Use generic phrasing like "a good [tool category] tool can help with that" or "I've used tools for this before." Avoid mentioning my product's name.
        4.  **Keep it Short & Conversational:** Aim for 2-4 sentences. Use a casual, friendly tone.
        5.  **Do NOT be spammy:** Avoid marketing language, calls to action, or any hint of a sales pitch.

        **Your generated plain-text comment:**
        """

        model = genai.GenerativeModel('gemini-1.5-flash-latest')
        response = model.generate_content(prompt)
        
        print(f"--- DEBUG: Gemini call successful. Response text: {response.text}")
        logging.info(f"AI REPLY: Successfully generated comment for user '{user_id}'.")
        return response.text

    except Exception as e:
        print(f"--- DEBUG: An error occurred inside Gemini call: {e}")
        logging.error(f"AI REPLY: A critical error occurred while generating reply for user {user_id}: {e}", exc_info=True)
        return "Error: Failed to generate AI reply due to a server issue."
