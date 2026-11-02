# XLead Project

An advanced backend and frontend integration system designed to automate lead generation and processing across various platforms using robust API integrations and AI-powered reply generation.

---

## Features

* **Automated Lead Scanning:** Scans targeted platforms and communities based on custom keywords and limits.
* **AI-Powered Response Generation:** Automatically generates contextual, high-converting replies for gathered leads.
* **Flexible Monitoring System:** Allows users to add, manage, and track custom product keywords and monitoring parameters.
* **RESTful API Architecture:** Built with Flask, providing clean and structured endpoints for frontend communication.
* **Secure Database Integration:** Utilizes Firebase Firestore for real-time data storage and efficient subcollection management.

---

## Tech Stack

* **Backend:** Python, Flask, Flask-CORS, Firebase Admin SDK
* **Frontend:** HTML5, CSS3, JavaScript
* **Database:** Google Firebase Firestore

---

## Project Structure

xlead-project/
│
├── backend/
│   ├── api.py           
│   ├── bot.py           
│   ├── scanner.py       
│   └── check_gemini.py  
│
├── frontend/
│   ├── index.html       
│   ├── main.js          
│   └── style.css        
│
└── README.md

---

## Getting Started

### Prerequisites

* Python 3.10+
* Firebase Account with Firestore enabled

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/simpro11/xlead-project.git](https://github.com/simpro11/xlead-project.git)
   cd xlead-project
Install backend dependencies:

Bash
pip install flask flask-cors firebase-admin requests
Configure Firebase:

Place your Firebase service account key file as serviceAccountKey.json inside the backend directory.

Run the application:

Bash
python backend/api.py
License
This project is open-source and available under the MIT License
