# ScAllywag Trivia — Deployment Guide
# Hosting + Database: Firebase (one account, no Netlify)

## Overview
Everything runs through Firebase — your Google account is all you need.
- Firebase Hosting serves the app at a shareable URL
- Firebase Realtime Database stores all shared data (scores, questions, plank history)
- No credit card, no Netlify, no Node.js required

Total setup time: ~15 minutes, one time only.

---

## Step 1 — Create your Firebase project

1. Go to **console.firebase.google.com**
2. Sign in with your Google account (Gmail works)
3. Click **"Create a project"**
4. Name it **ScAllywag** (or anything you like)
5. Turn **off** Google Analytics when asked
6. Click **"Create project"**, wait ~30 seconds, then click **"Continue"**

---

## Step 2 — Create the Realtime Database

1. In the left sidebar click **"Build"** → **"Realtime Database"**
2. Click **"Create Database"**
3. Choose the location closest to you
4. When asked about security rules, select **"Start in test mode"**
5. Click **"Enable"**

---

## Step 3 — Get your app config

1. Click the **gear icon ⚙️** next to "Project Overview" in the top left
2. Click **"Project settings"**
3. Scroll down to **"Your apps"** and click the **web icon ( </> )**
4. Give it a nickname like **ScAllywag**
5. **Check the box** that says **"Also set up Firebase Hosting"**
6. Click **"Register app"**
7. You will see a block of code like this — **copy it all:**

```
apiKey: "AIzaSy...",
authDomain: "scallywag-xxxxx.firebaseapp.com",
databaseURL: "https://scallywag-xxxxx-default-rtdb.firebaseio.com",
projectId: "scallywag-xxxxx",
storageBucket: "scallywag-xxxxx.appspot.com",
messagingSenderId: "123456789",
appId: "1:123456789:web:abcdef"
```

8. Click **"Next"** through the remaining screens (you can skip the npm steps)

---

## Step 4 — Add your config to the app

1. Open the **scallywag-pwa** folder
2. Open **app.js** in Notepad (right-click → Open with → Notepad)
3. Near the top find this block:

```
const firebaseConfig = {
  apiKey:            "REPLACE_WITH_YOUR_API_KEY",
  authDomain:        "REPLACE_WITH_YOUR_AUTH_DOMAIN",
  databaseURL:       "REPLACE_WITH_YOUR_DATABASE_URL",
  projectId:         "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket:     "REPLACE_WITH_YOUR_STORAGE_BUCKET",
  messagingSenderId: "REPLACE_WITH_YOUR_MESSAGING_SENDER_ID",
  appId:             "REPLACE_WITH_YOUR_APP_ID",
};
```

4. Replace each REPLACE_WITH_... value with the matching value from Firebase
   For example:
   apiKey: "REPLACE_WITH_YOUR_API_KEY"
   becomes:
   apiKey: "AIzaSy...",

5. Save the file (Ctrl+S)

---

## Step 5 — Upload files to Firebase Hosting

1. Go back to the Firebase console
2. In the left sidebar click **"Build"** → **"Hosting"**
3. Click **"Get started"** if you haven't already
4. Scroll down and look for **"Or upload files manually"** or click **"Add custom domain"** area
   — actually look for a button that says **"Deploy"** or an upload area
5. You will be asked to upload your files — select all files inside the scallywag-pwa folder:
   - index.html
   - app.js
   - sw.js
   - manifest.json
   - netlify.toml (can skip this one)
   - icons folder
6. Firebase gives you a URL like **https://scallywag-xxxxx.web.app**
7. That is the link to text to your crew!

---

## How players install it

### iPhone (must use Safari)
1. Open the link in Safari
2. Tap the Share button (box with arrow) at the bottom
3. Tap "Add to Home Screen"
4. Tap "Add"

### Android (Chrome)
1. Open the link in Chrome
2. Tap the three-dot menu → "Add to Home screen"
3. Tap "Install"

---

## How to update the app later

1. Edit app.js with your changes
2. Go to Firebase console → Hosting
3. Upload the changed files again
4. Everyone gets the update automatically — no new link needed

---

## What is shared across all players

- Questions submitted by anyone
- Everyone's scores (updates live)
- Flags on questions
- Plank Roulette history
- Bonus questions granted

Your name is the only thing stored on your own device.

