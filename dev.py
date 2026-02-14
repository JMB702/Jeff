#!/usr/bin/env python3
"""
Live development server for Tinder Bot Dashboard.

ONE command to rule them all:
    python3 dev.py

What it does:
  - Serves the dashboard at http://localhost:8000
  - Simulates profiles, conversations, and stats
  - Auto-pulls from git every 5 seconds
  - Auto-reloads your browser when files change
"""

import http.server
import socketserver
import os
import threading
import time
import json
import subprocess
import hashlib
import sys
import re
import random
from datetime import datetime, timedelta

PORT = 8000
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(SCRIPT_DIR, 'public')
BRANCH = 'claude/tinder-messaging-bot-sX6om'

# ─── Simulated Data ────────────────────────────────────────────────

is_killed = False

now = datetime.now()

DEMO_MATCHES = [
    {
        "match_id": "m_jessica_01", "name": "Jessica", "status": "chatting",
        "messages_sent": 8, "messages_received": 6, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "25, nurse at Denver Health. Big into hiking and her golden retriever Max. Sarcastic sense of humor. Mentions she loves dive bars and trying new restaurants. Good conversation hooks: dog, hiking trails, food spots.",
        "date_details": None,
        "created_at": (now - timedelta(days=2, hours=3)).isoformat(),
        "updated_at": (now - timedelta(minutes=45)).isoformat(),
        "last_message_at": (now - timedelta(minutes=45)).isoformat(),
    },
    {
        "match_id": "m_ashley_02", "name": "Ashley", "status": "date_pending",
        "messages_sent": 14, "messages_received": 12, "followups_sent": 1, "auto_messaging": True,
        "profile_summary": "27, graphic designer. Really into vinyl records, coffee shops, and indie films. Has a dry wit. Mentioned she's free this weekend and loves the RiNo area. Very responsive — replies within minutes.",
        "date_details": "Saturday evening drinks at Death & Co, 8pm",
        "created_at": (now - timedelta(days=4)).isoformat(),
        "updated_at": (now - timedelta(hours=2)).isoformat(),
        "last_message_at": (now - timedelta(hours=2)).isoformat(),
    },
    {
        "match_id": "m_taylor_03", "name": "Taylor", "status": "opener_sent",
        "messages_sent": 1, "messages_received": 0, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "23, grad student in psychology at CU. Photos show rock climbing, a cat, and a trip to Japan. Bio says 'looking for someone who can keep up.' Good opener angle: travel or climbing.",
        "date_details": None,
        "created_at": (now - timedelta(hours=6)).isoformat(),
        "updated_at": (now - timedelta(hours=6)).isoformat(),
        "last_message_at": None,
    },
    {
        "match_id": "m_rachel_04", "name": "Rachel", "status": "date_confirmed",
        "messages_sent": 18, "messages_received": 15, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "26, software engineer at a startup. Board game nerd, rock climber, makes her own pasta. Witty and direct. Already confirmed she's excited for the date.",
        "date_details": "Thursday 7pm, Avanti Food Hall",
        "created_at": (now - timedelta(days=6)).isoformat(),
        "updated_at": (now - timedelta(hours=8)).isoformat(),
        "last_message_at": (now - timedelta(hours=8)).isoformat(),
    },
    {
        "match_id": "m_megan_05", "name": "Megan", "status": "chatting",
        "messages_sent": 5, "messages_received": 4, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "24, bartender and aspiring DJ. Lots of festival photos. Bio: 'feed me tacos and tell me I'm pretty.' Playful energy, responds well to teasing.",
        "date_details": None,
        "created_at": (now - timedelta(days=1, hours=8)).isoformat(),
        "updated_at": (now - timedelta(hours=3)).isoformat(),
        "last_message_at": (now - timedelta(hours=3)).isoformat(),
    },
    {
        "match_id": "m_sarah_06", "name": "Sarah", "status": "ghosted",
        "messages_sent": 4, "messages_received": 2, "followups_sent": 2, "auto_messaging": True,
        "profile_summary": "28, works in marketing. Loves yoga, brunch, and her two cats. Bio is minimal — 'just here to see what happens.' Stopped responding after day 2.",
        "date_details": None,
        "created_at": (now - timedelta(days=5)).isoformat(),
        "updated_at": (now - timedelta(days=3)).isoformat(),
        "last_message_at": (now - timedelta(days=3)).isoformat(),
    },
    {
        "match_id": "m_emma_07", "name": "Emma", "status": "new",
        "messages_sent": 0, "messages_received": 0, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "22, studying education at MSU Denver. Photos with friends at Red Rocks, a pottery class, and a farmers market. Bio: 'tell me your favorite book.' Opener angle: books or Red Rocks.",
        "date_details": None,
        "created_at": (now - timedelta(minutes=30)).isoformat(),
        "updated_at": (now - timedelta(minutes=30)).isoformat(),
        "last_message_at": None,
    },
    {
        "match_id": "m_olivia_08", "name": "Olivia", "status": "date_proposed",
        "messages_sent": 11, "messages_received": 9, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "26, veterinarian. Dog mom x3. Into trail running, cooking, and true crime podcasts. Warm personality, asks lots of questions back. Bot just suggested meeting up.",
        "date_details": None,
        "created_at": (now - timedelta(days=3)).isoformat(),
        "updated_at": (now - timedelta(hours=1)).isoformat(),
        "last_message_at": (now - timedelta(hours=1)).isoformat(),
    },
    {
        "match_id": "m_nicole_09", "name": "Nicole", "status": "stopped",
        "messages_sent": 3, "messages_received": 1, "followups_sent": 1, "auto_messaging": True,
        "profile_summary": "29, real estate agent. Gym selfies, boat photos, travel pics. Bio: 'fluent in sarcasm.' Short responses, low engagement.",
        "date_details": None,
        "created_at": (now - timedelta(days=4)).isoformat(),
        "updated_at": (now - timedelta(days=2)).isoformat(),
        "last_message_at": (now - timedelta(days=2)).isoformat(),
    },
    {
        "match_id": "m_hannah_10", "name": "Hannah", "status": "chatting",
        "messages_sent": 6, "messages_received": 5, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "25, physical therapist. Snowboarder, craft beer lover, has a husky named Ghost. Bio: 'will definitely beat you at Mario Kart.' Fun energy, conversation flowing well.",
        "date_details": None,
        "created_at": (now - timedelta(days=1, hours=2)).isoformat(),
        "updated_at": (now - timedelta(hours=1, minutes=30)).isoformat(),
        "last_message_at": (now - timedelta(hours=1, minutes=30)).isoformat(),
    },
    {
        "match_id": "m_brittany_11", "name": "Brittany", "status": "chatting",
        "messages_sent": 9, "messages_received": 7, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "26, dental hygienist. Obsessed with her french bulldog Winston. Weekend warrior — paddleboarding, farmers markets, rooftop bars. Bio: 'Winston approves all matches first.'",
        "date_details": None,
        "created_at": (now - timedelta(days=2, hours=5)).isoformat(),
        "updated_at": (now - timedelta(hours=2, minutes=15)).isoformat(),
        "last_message_at": (now - timedelta(hours=2, minutes=15)).isoformat(),
    },
    {
        "match_id": "m_kayla_12", "name": "Kayla", "status": "date_pending",
        "messages_sent": 16, "messages_received": 14, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "24, yoga instructor and part-time model. Into plant-based cooking, sunrise hikes, and spontaneous road trips. Very flirty, uses lots of emojis. Great energy.",
        "date_details": "Sunday brunch at Snooze, 11am",
        "created_at": (now - timedelta(days=5, hours=2)).isoformat(),
        "updated_at": (now - timedelta(hours=4)).isoformat(),
        "last_message_at": (now - timedelta(hours=4)).isoformat(),
    },
    {
        "match_id": "m_sophia_13", "name": "Sophia", "status": "chatting",
        "messages_sent": 4, "messages_received": 3, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "27, architect. Clean aesthetic, photos at art galleries and modern buildings. Bio: 'I have strong opinions about fonts.' Intellectual humor, responds thoughtfully.",
        "date_details": None,
        "created_at": (now - timedelta(days=1, hours=5)).isoformat(),
        "updated_at": (now - timedelta(hours=4, minutes=30)).isoformat(),
        "last_message_at": (now - timedelta(hours=4, minutes=30)).isoformat(),
    },
    {
        "match_id": "m_madison_14", "name": "Madison", "status": "ghosted",
        "messages_sent": 6, "messages_received": 3, "followups_sent": 2, "auto_messaging": True,
        "profile_summary": "25, flight attendant. Travel photos everywhere — Bali, Paris, Tokyo. Bio: 'probably on a plane rn.' Hard to pin down, sporadic replies before going silent.",
        "date_details": None,
        "created_at": (now - timedelta(days=7)).isoformat(),
        "updated_at": (now - timedelta(days=4)).isoformat(),
        "last_message_at": (now - timedelta(days=4)).isoformat(),
    },
    {
        "match_id": "m_lauren_15", "name": "Lauren", "status": "opener_sent",
        "messages_sent": 1, "messages_received": 0, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "23, barista and aspiring comedian. Open mic photos, cat memes on her profile. Bio: 'swipe right if you laugh at your own jokes.' Great opener potential with humor angle.",
        "date_details": None,
        "created_at": (now - timedelta(hours=3)).isoformat(),
        "updated_at": (now - timedelta(hours=3)).isoformat(),
        "last_message_at": None,
    },
    {
        "match_id": "m_chloe_16", "name": "Chloe", "status": "date_confirmed",
        "messages_sent": 20, "messages_received": 18, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "28, ER doctor. Surprisingly chill despite the job. Into wine tasting, mystery novels, and her two rescue cats. Very direct, appreciates honesty. Excited about the date.",
        "date_details": "Friday 7:30pm, Barcelona Wine Bar",
        "created_at": (now - timedelta(days=8)).isoformat(),
        "updated_at": (now - timedelta(hours=12)).isoformat(),
        "last_message_at": (now - timedelta(hours=12)).isoformat(),
    },
    {
        "match_id": "m_morgan_17", "name": "Morgan", "status": "new",
        "messages_sent": 0, "messages_received": 0, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "24, music producer. Studio shots, festival wristbands, vinyl collection. Bio: 'I'll make you a playlist.' Creative type, good conversation starter with music.",
        "date_details": None,
        "created_at": (now - timedelta(minutes=15)).isoformat(),
        "updated_at": (now - timedelta(minutes=15)).isoformat(),
        "last_message_at": None,
    },
    {
        "match_id": "m_alexis_18", "name": "Alexis", "status": "chatting",
        "messages_sent": 7, "messages_received": 6, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "26, personal trainer. Competitive CrossFitter, meal prep queen. Photos are all action shots — lifting, running, obstacle courses. Bio: 'looking for a gym partner and a dinner partner.'",
        "date_details": None,
        "created_at": (now - timedelta(days=2)).isoformat(),
        "updated_at": (now - timedelta(hours=5)).isoformat(),
        "last_message_at": (now - timedelta(hours=5)).isoformat(),
    },
    {
        "match_id": "m_zoe_19", "name": "Zoe", "status": "date_proposed",
        "messages_sent": 10, "messages_received": 8, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "25, kindergarten teacher. Wholesome energy — baking, gardening, game nights. Bio: 'I'll share my snacks.' Warm and easy to talk to. Bot just asked her out.",
        "date_details": None,
        "created_at": (now - timedelta(days=3, hours=4)).isoformat(),
        "updated_at": (now - timedelta(hours=2, minutes=30)).isoformat(),
        "last_message_at": (now - timedelta(hours=2, minutes=30)).isoformat(),
    },
    {
        "match_id": "m_vanessa_20", "name": "Vanessa", "status": "unmatched",
        "messages_sent": 2, "messages_received": 1, "followups_sent": 0, "auto_messaging": True,
        "profile_summary": "30, lawyer. Professional headshot as first photo. Bio: 'looking for something real.' Unmatched after bot's second message — may have been too forward.",
        "date_details": None,
        "created_at": (now - timedelta(days=3)).isoformat(),
        "updated_at": (now - timedelta(days=2, hours=6)).isoformat(),
        "last_message_at": (now - timedelta(days=2, hours=6)).isoformat(),
    },
]

DEMO_CONVERSATIONS = {
    "m_jessica_01": [
        {"role": "assistant", "content": "I see you've got a golden retriever — I have a serious question: does Max judge your dating life as hard as my friends do?", "timestamp": (now - timedelta(days=2, hours=2)).isoformat()},
        {"role": "user", "content": "Haha omg yes! He gives me this look every time I get ready to go out 😂", "timestamp": (now - timedelta(days=2, hours=1, minutes=45)).isoformat()},
        {"role": "assistant", "content": "Classic Max. He's just protective. So what's your go-to hike around here? I've been exploring a lot of trails lately", "timestamp": (now - timedelta(days=2, hours=1, minutes=30)).isoformat()},
        {"role": "user", "content": "I love the Flatirons! And there's this hidden trail near Chautauqua that's amazing. You?", "timestamp": (now - timedelta(days=1, hours=20)).isoformat()},
        {"role": "assistant", "content": "Chautauqua's great. I did the Royal Arch trail last month and my legs still haven't forgiven me. But the view was worth it", "timestamp": (now - timedelta(days=1, hours=19, minutes=30)).isoformat()},
        {"role": "user", "content": "Royal Arch is so good!! Ok you clearly have taste. What about food — any good spots you've found?", "timestamp": (now - timedelta(days=1, hours=18)).isoformat()},
        {"role": "assistant", "content": "There's this place in LoHi that does incredible tacos. Hole in the wall, no sign on the door, but the al pastor will change your life. Kind of place you need a local guide for 😏", "timestamp": (now - timedelta(days=1, hours=17, minutes=30)).isoformat()},
        {"role": "user", "content": "Wait you can't just say that and not tell me where it is! Are you volunteering as tour guide? 👀", "timestamp": (now - timedelta(minutes=45)).isoformat()},
        {"role": "assistant", "content": "I mean I do know the secret knock to get in... could probably be persuaded to show you. What does your week look like?", "timestamp": (now - timedelta(minutes=40)).isoformat()},
        {"role": "user", "content": "I'm free Thursday evening or Saturday afternoon! You pick 😊", "timestamp": (now - timedelta(minutes=35)).isoformat()},
    ],
    "m_ashley_02": [
        {"role": "assistant", "content": "Your vinyl collection looks serious. Please tell me you have at least one embarrassing guilty pleasure album in there", "timestamp": (now - timedelta(days=4)).isoformat()},
        {"role": "user", "content": "I will neither confirm nor deny owning the full ABBA discography", "timestamp": (now - timedelta(days=3, hours=22)).isoformat()},
        {"role": "assistant", "content": "ABBA is not a guilty pleasure, that's just good taste. Dancing Queen is an objectively perfect song and I will die on that hill", "timestamp": (now - timedelta(days=3, hours=21)).isoformat()},
        {"role": "user", "content": "Ok I already like you. Most guys on here just say 'nice pics' so this is refreshing lol", "timestamp": (now - timedelta(days=3, hours=20)).isoformat()},
        {"role": "assistant", "content": "\"Nice pics\" is for people who peaked in middle school. I'm more interested in whether you're team pour-over or team espresso", "timestamp": (now - timedelta(days=3, hours=19)).isoformat()},
        {"role": "user", "content": "Pour-over at home, oat milk latte when I'm out. I have a whole setup it's honestly a bit much", "timestamp": (now - timedelta(days=3, hours=18)).isoformat()},
        {"role": "assistant", "content": "A whole setup? OK now I need details. Are we talking Chemex? V60? Please tell me you have a gooseneck kettle", "timestamp": (now - timedelta(days=3, hours=17)).isoformat()},
        {"role": "user", "content": "V60 AND a Chemex depending on my mood. And yes obviously a gooseneck. I'm not an animal", "timestamp": (now - timedelta(days=3, hours=16)).isoformat()},
        {"role": "assistant", "content": "This is the most attractive thing anyone has ever said to me on this app. We should grab coffee sometime so you can judge my order in person", "timestamp": (now - timedelta(days=3, hours=15)).isoformat()},
        {"role": "user", "content": "Haha I would love that! I know all the best spots in RiNo", "timestamp": (now - timedelta(days=3, hours=14)).isoformat()},
        {"role": "assistant", "content": "RiNo is my favorite area. What about Saturday evening? We could do coffee that turns into drinks if the vibe is right", "timestamp": (now - timedelta(days=3, hours=13)).isoformat()},
        {"role": "user", "content": "Saturday works! Do you know Death & Co? Amazing cocktails", "timestamp": (now - timedelta(days=3, hours=12)).isoformat()},
        {"role": "assistant", "content": "Death & Co is perfect. Let's say 8pm? I'll be the one who definitely doesn't look nervous", "timestamp": (now - timedelta(days=3, hours=11)).isoformat()},
        {"role": "user", "content": "It's a date! 8pm Saturday. I'll be the one judging your drink order 😉", "timestamp": (now - timedelta(hours=2)).isoformat()},
    ],
    "m_taylor_03": [
        {"role": "assistant", "content": "That photo from Japan is amazing — Fushimi Inari? I did that hike at sunrise and it was one of those 'ok this is why I travel' moments. What was the highlight of your trip?", "timestamp": (now - timedelta(hours=6)).isoformat()},
    ],
    "m_rachel_04": [
        {"role": "assistant", "content": "You make your own pasta AND you rock climb? I feel like you're either extremely cool or a fictional character", "timestamp": (now - timedelta(days=6)).isoformat()},
        {"role": "user", "content": "Haha definitely real! Though my pasta skills are way better than my climbing skills tbh", "timestamp": (now - timedelta(days=5, hours=22)).isoformat()},
        {"role": "assistant", "content": "Respect the honesty. What's your go-to pasta? I'm trying to gauge if we can actually be friends here", "timestamp": (now - timedelta(days=5, hours=21)).isoformat()},
        {"role": "user", "content": "Cacio e pepe. Simple but if you nail the technique it's *chef's kiss*. What about you, what's your signature dish?", "timestamp": (now - timedelta(days=5, hours=20)).isoformat()},
        {"role": "assistant", "content": "Cacio e pepe is the correct answer. Mine's a Thai basil stir fry — not as impressive but I've been perfecting it for years", "timestamp": (now - timedelta(days=5, hours=19)).isoformat()},
        {"role": "user", "content": "Omg I love Thai food! Ok we need to do a cook-off at some point", "timestamp": (now - timedelta(days=5, hours=18)).isoformat()},
        {"role": "assistant", "content": "A cook-off is a bold first date move. I was gonna suggest drinks but honestly I'm into it. You pick the venue — your kitchen or a neutral location?", "timestamp": (now - timedelta(days=5, hours=17)).isoformat()},
        {"role": "user", "content": "Haha maybe drinks first and we work up to the cook-off 😂", "timestamp": (now - timedelta(days=5, hours=16)).isoformat()},
        {"role": "assistant", "content": "Fair enough 😄 Avanti Food Hall? Tons of options so nobody has to commit to just one cuisine. Thursday evening work for you?", "timestamp": (now - timedelta(days=5, hours=15)).isoformat()},
        {"role": "user", "content": "Thursday at Avanti is perfect!! I love that place. 7pm?", "timestamp": (now - timedelta(days=5, hours=14)).isoformat()},
        {"role": "assistant", "content": "7pm Thursday, Avanti. I'll be the one definitely not rehearsing conversation starters in the mirror beforehand", "timestamp": (now - timedelta(days=5, hours=13)).isoformat()},
        {"role": "user", "content": "Lmaooo you're funny. I'm actually really looking forward to it 😊", "timestamp": (now - timedelta(hours=8)).isoformat()},
    ],
    "m_megan_05": [
        {"role": "assistant", "content": "Your bio says feed you tacos — but I need to know your stance on a critical issue first: corn or flour tortillas?", "timestamp": (now - timedelta(days=1, hours=7)).isoformat()},
        {"role": "user", "content": "Corn obviously!! Flour is for burritos only. This is non-negotiable", "timestamp": (now - timedelta(days=1, hours=6)).isoformat()},
        {"role": "assistant", "content": "We can be friends. Flour tortilla people are not to be trusted. So what kind of music do you spin?", "timestamp": (now - timedelta(days=1, hours=5)).isoformat()},
        {"role": "user", "content": "House and tech house mostly! I have a residency at a spot on Fridays. You into electronic music?", "timestamp": (now - timedelta(days=1, hours=4)).isoformat()},
        {"role": "assistant", "content": "I appreciate someone who actually DJs and doesn't just hit play on a Spotify playlist. Friday residency is legit. What spot?", "timestamp": (now - timedelta(hours=3, minutes=30)).isoformat()},
        {"role": "user", "content": "It's called The Venue on Broadway! You should come by sometime, I'll put you on the list 😏", "timestamp": (now - timedelta(hours=3)).isoformat()},
    ],
    "m_sarah_06": [
        {"role": "assistant", "content": "Two cats AND yoga? You're living the dream honestly. What are the cats' names?", "timestamp": (now - timedelta(days=5)).isoformat()},
        {"role": "user", "content": "Mochi and Boba 🐱", "timestamp": (now - timedelta(days=4, hours=20)).isoformat()},
        {"role": "assistant", "content": "Those names are incredible. Let me guess — Mochi is the chill one and Boba is chaos?", "timestamp": (now - timedelta(days=4, hours=19)).isoformat()},
        {"role": "user", "content": "Haha actually the opposite! Mochi is the troublemaker", "timestamp": (now - timedelta(days=4, hours=18)).isoformat()},
        {"role": "assistant", "content": "Classic plot twist. So what's your go-to brunch spot? I'm always looking for new recommendations", "timestamp": (now - timedelta(days=4, hours=17)).isoformat()},
        {"role": "assistant", "content": "Hope your week's going well! Any good brunch adventures lately?", "timestamp": (now - timedelta(days=3, hours=12)).isoformat()},
    ],
    "m_emma_07": [],
    "m_olivia_08": [
        {"role": "assistant", "content": "Three dogs? That's not a pet situation, that's a pack. I respect the commitment. What breeds are we working with?", "timestamp": (now - timedelta(days=3)).isoformat()},
        {"role": "user", "content": "A golden, a border collie, and a mutt who thinks she's the boss (she is)", "timestamp": (now - timedelta(days=2, hours=22)).isoformat()},
        {"role": "assistant", "content": "The mutt is always the boss, that's just science. Do they all come on your trail runs or is that pure chaos?", "timestamp": (now - timedelta(days=2, hours=21)).isoformat()},
        {"role": "user", "content": "Haha only the border collie can keep up! The golden just wants to sniff everything and the mutt stages a protest after mile 1", "timestamp": (now - timedelta(days=2, hours=20)).isoformat()},
        {"role": "assistant", "content": "The mutt staging a protest is the most relatable thing I've heard all week. What's the best trail you've found around here?", "timestamp": (now - timedelta(days=2, hours=19)).isoformat()},
        {"role": "user", "content": "Mt Falcon is amazing! Great views and the dogs love it. Also really into the trails near Evergreen", "timestamp": (now - timedelta(days=2, hours=18)).isoformat()},
        {"role": "assistant", "content": "Mt Falcon is gorgeous. I did the Castle Trail loop there — the ruins at the top are so cool. What true crime podcast are you into right now?", "timestamp": (now - timedelta(days=2, hours=17)).isoformat()},
        {"role": "user", "content": "Ok I'm obsessed with Crime Junkie right now. Have you listened?", "timestamp": (now - timedelta(days=2, hours=16)).isoformat()},
        {"role": "assistant", "content": "Crime Junkie is great! I went down a rabbit hole on their Serial copycat episodes. We clearly have compatible taste — maybe we should continue this over coffee sometime?", "timestamp": (now - timedelta(days=1, hours=5)).isoformat()},
        {"role": "user", "content": "That would be really fun! I know a great dog-friendly patio if you're down for that kind of vibe", "timestamp": (now - timedelta(hours=1)).isoformat()},
        {"role": "assistant", "content": "Dog-friendly patio is literally the perfect first date. I'm in. What day works for you?", "timestamp": (now - timedelta(minutes=55)).isoformat()},
    ],
    "m_nicole_09": [
        {"role": "assistant", "content": "Fluent in sarcasm — ok prove it. What's the most sarcastic thing you've said this week?", "timestamp": (now - timedelta(days=4)).isoformat()},
        {"role": "user", "content": "Lol nice one", "timestamp": (now - timedelta(days=3, hours=20)).isoformat()},
        {"role": "assistant", "content": "I'll take that as 'I'm saving my best material for in person.' Fair enough. So what do you like to do for fun around here?", "timestamp": (now - timedelta(days=3, hours=19)).isoformat()},
        {"role": "assistant", "content": "Hope you're having a good week! Would love to hear about your favorite spots in the city", "timestamp": (now - timedelta(days=2, hours=12)).isoformat()},
    ],
    "m_hannah_10": [
        {"role": "assistant", "content": "A husky named Ghost? Please tell me that's a Game of Thrones reference because if so we need to be best friends immediately", "timestamp": (now - timedelta(days=1, hours=1)).isoformat()},
        {"role": "user", "content": "YES it is!! Finally someone gets it! Most people just think I named him that because he's white 😂", "timestamp": (now - timedelta(days=1, hours=0, minutes=45)).isoformat()},
        {"role": "assistant", "content": "White husky named Ghost — that's tier 1 dog naming right there. Jon Snow would be proud. So you snowboard too? Where do you ride?", "timestamp": (now - timedelta(days=1, hours=0, minutes=30)).isoformat()},
        {"role": "user", "content": "Mostly Keystone and Breck! I'm trying to get better at trees this season. You ride?", "timestamp": (now - timedelta(hours=22)).isoformat()},
        {"role": "assistant", "content": "I do! Breck is my go-to. Peak 8 bowl on a powder day is about as close to heaven as it gets. Have you hit A-Basin yet this season?", "timestamp": (now - timedelta(hours=21)).isoformat()},
        {"role": "user", "content": "Not yet!! I keep hearing the snow up there has been amazing though. We should go sometime!", "timestamp": (now - timedelta(hours=20)).isoformat()},
        {"role": "assistant", "content": "A-Basin day trip could be fun. But first things first — I need to verify your Mario Kart claims. What's your main?", "timestamp": (now - timedelta(hours=5)).isoformat()},
        {"role": "user", "content": "Yoshi. Always Yoshi. And I WILL destroy you on Rainbow Road", "timestamp": (now - timedelta(hours=4)).isoformat()},
        {"role": "assistant", "content": "Rainbow Road trash talk? Now it's personal. Toad main here. We're going to need to settle this in person", "timestamp": (now - timedelta(hours=3)).isoformat()},
        {"role": "user", "content": "Name the time and place!! Loser buys drinks 🎮🍺", "timestamp": (now - timedelta(hours=1, minutes=30)).isoformat()},
    ],
    "m_brittany_11": [
        {"role": "assistant", "content": "Winston the french bulldog — does he snore as loud as every frenchie I've ever met?", "timestamp": (now - timedelta(days=2, hours=4)).isoformat()},
        {"role": "user", "content": "Louder. My neighbors have complained 😂 but he's worth it", "timestamp": (now - timedelta(days=2, hours=3)).isoformat()},
        {"role": "assistant", "content": "A snoring legend. I respect a dog with presence. So paddleboarding — do you go on the reservoir or somewhere else?", "timestamp": (now - timedelta(days=2, hours=2)).isoformat()},
        {"role": "user", "content": "Cherry Creek reservoir mostly! It's so peaceful in the mornings. Have you tried it?", "timestamp": (now - timedelta(days=1, hours=20)).isoformat()},
        {"role": "assistant", "content": "I haven't but it's been on my list. I feel like I'd spend the first 30 minutes just falling in", "timestamp": (now - timedelta(days=1, hours=19)).isoformat()},
        {"role": "user", "content": "Haha everyone does at first! That's the fun part. I could teach you if you want 😊", "timestamp": (now - timedelta(days=1, hours=18)).isoformat()},
        {"role": "assistant", "content": "A paddleboard lesson from a pro? I'm in. Though I should warn you, my balance is questionable at best", "timestamp": (now - timedelta(hours=6)).isoformat()},
        {"role": "user", "content": "That makes it more entertaining for me honestly 😂 and after we can grab drinks at the bar nearby", "timestamp": (now - timedelta(hours=5)).isoformat()},
        {"role": "assistant", "content": "Paddleboarding followed by drinks? You just planned the perfect date without even trying", "timestamp": (now - timedelta(hours=4)).isoformat()},
        {"role": "user", "content": "Who says I wasn't trying? 😏 When are you free?", "timestamp": (now - timedelta(hours=2, minutes=15)).isoformat()},
    ],
    "m_kayla_12": [
        {"role": "assistant", "content": "Your sunrise hike photos are making me feel very unproductive. What time do you actually wake up for those?", "timestamp": (now - timedelta(days=5, hours=1)).isoformat()},
        {"role": "user", "content": "4:30am 🌅 I know I know I'm insane lol", "timestamp": (now - timedelta(days=5)).isoformat()},
        {"role": "assistant", "content": "4:30am is not a wake-up time, that's a lifestyle choice. But those views look worth it honestly", "timestamp": (now - timedelta(days=4, hours=22)).isoformat()},
        {"role": "user", "content": "It's literally the best!! The world is so quiet and the colors are 😍😍😍 you should try it!", "timestamp": (now - timedelta(days=4, hours=20)).isoformat()},
        {"role": "assistant", "content": "I'll need approximately three coffees but I'm not opposed. What's the best sunrise spot you've found?", "timestamp": (now - timedelta(days=4, hours=18)).isoformat()},
        {"role": "user", "content": "Lookout Mountain!! The view of the city at sunrise is unreal. Also there's this hidden spot near Golden that's incredible", "timestamp": (now - timedelta(days=4, hours=16)).isoformat()},
        {"role": "assistant", "content": "A hidden spot? Now you're speaking my language. I'm always looking for places that aren't overrun with influencers", "timestamp": (now - timedelta(days=3, hours=10)).isoformat()},
        {"role": "user", "content": "Right?? It's just me and the deer out there 🦌 I'll take you sometime!", "timestamp": (now - timedelta(days=3, hours=8)).isoformat()},
        {"role": "assistant", "content": "Deal. But maybe we start with brunch at a normal human hour first so we can properly introduce ourselves? 😄", "timestamp": (now - timedelta(days=2, hours=5)).isoformat()},
        {"role": "user", "content": "Omg yes!! Do you know Snooze? Their pancake flight is AMAZING", "timestamp": (now - timedelta(days=2, hours=3)).isoformat()},
        {"role": "assistant", "content": "Snooze is incredible. Sunday brunch? I'll bring my appetite and you bring recommendations", "timestamp": (now - timedelta(days=1, hours=10)).isoformat()},
        {"role": "user", "content": "Sunday at 11?? I'm so down!! This is gonna be fun 🥞✨", "timestamp": (now - timedelta(hours=4)).isoformat()},
    ],
    "m_sophia_13": [
        {"role": "assistant", "content": "Strong opinions about fonts — I need to hear this. What's the worst font crime you've witnessed?", "timestamp": (now - timedelta(days=1, hours=4)).isoformat()},
        {"role": "user", "content": "Comic Sans on a law firm's letterhead. I still have nightmares.", "timestamp": (now - timedelta(days=1, hours=3)).isoformat()},
        {"role": "assistant", "content": "That's a felony in at least three states. What's your font of choice? I feel like this says a lot about a person", "timestamp": (now - timedelta(days=1, hours=2)).isoformat()},
        {"role": "user", "content": "Garamond for print, Inter for digital. And yes it absolutely does say a lot about someone. What's yours?", "timestamp": (now - timedelta(hours=8)).isoformat()},
        {"role": "assistant", "content": "Garamond is a sophisticated choice. I'm partial to Helvetica — which I know is basic, but sometimes the classics are classic for a reason", "timestamp": (now - timedelta(hours=7)).isoformat()},
        {"role": "user", "content": "Helvetica is the little black dress of fonts. I can respect that. Ok you passed the vibe check", "timestamp": (now - timedelta(hours=6)).isoformat()},
        {"role": "assistant", "content": "Best compliment I've gotten on this app. So what's the coolest building you've worked on?", "timestamp": (now - timedelta(hours=5)).isoformat()},
    ],
    "m_madison_14": [
        {"role": "assistant", "content": "Bali, Paris, Tokyo — your passport is living its best life. Which city surprised you the most?", "timestamp": (now - timedelta(days=7)).isoformat()},
        {"role": "user", "content": "Tokyo for sure! The food scene is insane", "timestamp": (now - timedelta(days=6, hours=10)).isoformat()},
        {"role": "assistant", "content": "Tokyo food is on another level. Did you hit up any of the little ramen spots in the alleys? Those hole-in-the-wall places are the best", "timestamp": (now - timedelta(days=6, hours=8)).isoformat()},
        {"role": "user", "content": "Yes!! There was this one in Golden Gai that changed my life honestly", "timestamp": (now - timedelta(days=5, hours=12)).isoformat()},
        {"role": "assistant", "content": "Golden Gai is magic. So with all the traveling, what's your favorite thing to come home to in Denver?", "timestamp": (now - timedelta(days=5, hours=10)).isoformat()},
        {"role": "assistant", "content": "Hey! Hope your travels are treating you well. Would love to hear more about your adventures when you're back in town", "timestamp": (now - timedelta(days=4, hours=8)).isoformat()},
    ],
    "m_lauren_15": [
        {"role": "assistant", "content": "I absolutely laugh at my own jokes — mostly because nobody else does. What's the worst bomb you've had at open mic?", "timestamp": (now - timedelta(hours=3)).isoformat()},
    ],
    "m_chloe_16": [
        {"role": "assistant", "content": "An ER doctor who reads mystery novels — you basically solve cases all day and then go home and solve more for fun?", "timestamp": (now - timedelta(days=8)).isoformat()},
        {"role": "user", "content": "Ha! I never thought of it that way but yes basically 😂 the novels have better endings though", "timestamp": (now - timedelta(days=7, hours=20)).isoformat()},
        {"role": "assistant", "content": "Darker than I expected from someone with rescue cats. I like it. What are you reading right now?", "timestamp": (now - timedelta(days=7, hours=18)).isoformat()},
        {"role": "user", "content": "The Maid by Nita Prose! It's so good. You read much?", "timestamp": (now - timedelta(days=7, hours=16)).isoformat()},
        {"role": "assistant", "content": "I've been meaning to read that one. Lately I've been into thrillers — just finished Project Hail Mary which isn't a mystery but I couldn't put it down", "timestamp": (now - timedelta(days=7, hours=14)).isoformat()},
        {"role": "user", "content": "PROJECT HAIL MARY. That book is incredible!! Rocky is the best character ever written", "timestamp": (now - timedelta(days=7, hours=12)).isoformat()},
        {"role": "assistant", "content": "Rocky is a national treasure from another solar system. Ok clearly we have compatible taste — wine bar sometime?", "timestamp": (now - timedelta(days=5, hours=8)).isoformat()},
        {"role": "user", "content": "I would love that! I know a great spot — Barcelona Wine Bar. Have you been?", "timestamp": (now - timedelta(days=5, hours=6)).isoformat()},
        {"role": "assistant", "content": "Haven't been but I've heard amazing things. Friday evening? We can debate which mystery novels have the worst endings", "timestamp": (now - timedelta(days=4, hours=10)).isoformat()},
        {"role": "user", "content": "Friday at 7:30? And oh I have OPINIONS about bad mystery endings 😂", "timestamp": (now - timedelta(days=4, hours=8)).isoformat()},
        {"role": "assistant", "content": "7:30 Friday, Barcelona Wine Bar. I'll brush up on my hot takes so I can keep up", "timestamp": (now - timedelta(days=3, hours=5)).isoformat()},
        {"role": "user", "content": "Can't wait!! This is going to be fun 🍷", "timestamp": (now - timedelta(hours=12)).isoformat()},
    ],
    "m_morgan_17": [],
    "m_alexis_18": [
        {"role": "assistant", "content": "Looking for a gym partner AND a dinner partner — that's either very efficient or very ambitious. What's your current PR on deadlift?", "timestamp": (now - timedelta(days=2)).isoformat()},
        {"role": "user", "content": "315! Working toward 335 by summer. You lift?", "timestamp": (now - timedelta(days=1, hours=22)).isoformat()},
        {"role": "assistant", "content": "315 is no joke, respect. I do lift but I'm more of a 'quiet gym headphones zone out' person than a CrossFit person", "timestamp": (now - timedelta(days=1, hours=20)).isoformat()},
        {"role": "user", "content": "Nothing wrong with that! As long as you're not curling in the squat rack we're good 😂", "timestamp": (now - timedelta(days=1, hours=18)).isoformat()},
        {"role": "assistant", "content": "I would never disrespect the squat rack like that. That's grounds for gym excommunication. So what's on the dinner partner side — what's your go-to food?", "timestamp": (now - timedelta(days=1, hours=8)).isoformat()},
        {"role": "user", "content": "I'm all about high protein but I also love sushi. Like LOVE sushi. It's a problem", "timestamp": (now - timedelta(days=1, hours=6)).isoformat()},
        {"role": "assistant", "content": "Sushi is the perfect food. High protein, delicious, and you look classy eating it. Win-win-win", "timestamp": (now - timedelta(hours=10)).isoformat()},
        {"role": "user", "content": "Ok you get it!! Do you know Sushi Den? It's the best in Denver hands down", "timestamp": (now - timedelta(hours=8)).isoformat()},
        {"role": "assistant", "content": "Sushi Den is incredible. We should go — I promise not to judge your California roll order", "timestamp": (now - timedelta(hours=6)).isoformat()},
        {"role": "user", "content": "Excuse me I would NEVER order a California roll 😤 omakase or nothing. But yes let's go!!", "timestamp": (now - timedelta(hours=5)).isoformat()},
    ],
    "m_zoe_19": [
        {"role": "assistant", "content": "A kindergarten teacher who shares snacks? That's basically the most trustworthy person on this entire app", "timestamp": (now - timedelta(days=3, hours=3)).isoformat()},
        {"role": "user", "content": "Haha I do always have goldfish crackers in my bag if that counts 😂", "timestamp": (now - timedelta(days=3, hours=2)).isoformat()},
        {"role": "assistant", "content": "Goldfish crackers absolutely count. The flavor blasted ones? Or are you a purist?", "timestamp": (now - timedelta(days=3, hours=1)).isoformat()},
        {"role": "user", "content": "Flavor blasted cheddar. This is the hill I will die on", "timestamp": (now - timedelta(days=2, hours=20)).isoformat()},
        {"role": "assistant", "content": "Flavor blasted is the correct answer. Regular goldfish are just sad crackers pretending. What's the wildest thing a kid has said to you this week?", "timestamp": (now - timedelta(days=2, hours=18)).isoformat()},
        {"role": "user", "content": "One kid told me my shoes were 'giving grandma' today so that was humbling 💀", "timestamp": (now - timedelta(days=2, hours=16)).isoformat()},
        {"role": "assistant", "content": "Kids are brutally honest and I respect it. No notes, just raw truth. Your baking photos look amazing btw — what's your specialty?", "timestamp": (now - timedelta(days=2, hours=5)).isoformat()},
        {"role": "user", "content": "Sourdough!! I have a starter named Gerald and he's basically my child", "timestamp": (now - timedelta(days=2, hours=3)).isoformat()},
        {"role": "assistant", "content": "Gerald the sourdough starter. That's incredible. I'd love to try some of your baking sometime — maybe we could grab coffee and you can bring a sample? 😄", "timestamp": (now - timedelta(hours=5)).isoformat()},
        {"role": "user", "content": "Aww that's so sweet! I actually know a great coffee shop with a bakery next door, we could go there!", "timestamp": (now - timedelta(hours=2, minutes=30)).isoformat()},
    ],
    "m_vanessa_20": [
        {"role": "assistant", "content": "A lawyer looking for something real — that's refreshing. What kind of law do you practice?", "timestamp": (now - timedelta(days=3)).isoformat()},
        {"role": "user", "content": "Corporate M&A. It's intense but I love it", "timestamp": (now - timedelta(days=2, hours=18)).isoformat()},
        {"role": "assistant", "content": "M&A is no joke — you must have nerves of steel. What do you do to unwind from all that?", "timestamp": (now - timedelta(days=2, hours=16)).isoformat()},
    ],
}


def get_demo_stats():
    active = [m for m in DEMO_MATCHES if m['status'] in ('new', 'opener_sent', 'chatting', 'date_proposed', 'date_pending')]
    dates = [m for m in DEMO_MATCHES if m['status'] in ('date_confirmed', 'date_pending')]
    total_sent = sum(m['messages_sent'] for m in DEMO_MATCHES)
    by_status = {}
    for m in DEMO_MATCHES:
        by_status[m['status']] = by_status.get(m['status'], 0) + 1
    return {
        "total": len(DEMO_MATCHES),
        "messages_sent_total": total_sent,
        "dates_confirmed": len([m for m in DEMO_MATCHES if m['status'] == 'date_confirmed']),
        "by_status": by_status,
    }


# ─── Server ────────────────────────────────────────────────────────

SERVER_ID = str(time.time())  # changes on every restart


def get_file_hash():
    """Get hash of index.html + server identity to detect changes and restarts."""
    try:
        with open(os.path.join(PUBLIC_DIR, 'index.html'), 'rb') as f:
            content_hash = hashlib.md5(f.read()).hexdigest()
        return content_hash + SERVER_ID
    except Exception:
        return SERVER_ID


def git_pull_loop():
    """Pull from the feature branch every 5 seconds."""
    subprocess.run(
        ['git', 'checkout', BRANCH],
        cwd=SCRIPT_DIR, capture_output=True, text=True, timeout=15
    )
    while True:
        time.sleep(5)
        try:
            result = subprocess.run(
                ['git', 'pull', 'origin', BRANCH],
                cwd=SCRIPT_DIR,
                capture_output=True,
                text=True,
                timeout=15
            )
            stdout = result.stdout.strip()
            if stdout and 'Already up to date' not in stdout:
                print(f'  [auto-update] New changes pulled from git')
        except Exception:
            pass


def send_json(handler, data, status=200):
    body = json.dumps(data).encode()
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Cache-Control', 'no-store')
    handler.end_headers()
    handler.wfile.write(body)


class DevHandler(http.server.SimpleHTTPRequestHandler):
    """Serves files + mock API endpoints + live reload."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def do_GET(self):
        global is_killed

        # Live reload hash endpoint
        if self.path == '/__hash':
            send_json(self, {'h': get_file_hash()})
            return

        # --- Mock API endpoints ---

        if self.path == '/api/stats':
            send_json(self, get_demo_stats())
            return

        if self.path == '/api/matches':
            send_json(self, DEMO_MATCHES)
            return

        if self.path == '/api/bot/status':
            send_json(self, {'killed': is_killed})
            return

        # GET /api/matches/:id/conversation
        conv_match = re.match(r'^/api/matches/([^/]+)/conversation$', self.path)
        if conv_match:
            match_id = conv_match.group(1)
            match = next((m for m in DEMO_MATCHES if m['match_id'] == match_id), None)
            convo = DEMO_CONVERSATIONS.get(match_id, [])
            if match:
                send_json(self, {'match': match, 'conversation': convo})
            else:
                send_json(self, {'match': None, 'conversation': []}, 404)
            return

        # SSE endpoint — just keep alive, no events in demo
        if self.path == '/api/events':
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.end_headers()
            try:
                while True:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
                    time.sleep(15)
            except Exception:
                pass
            return

        # Serve index.html with no-cache headers
        if self.path in ('/', '/index.html'):
            try:
                with open(os.path.join(PUBLIC_DIR, 'index.html'), 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
                self.send_header('Pragma', 'no-cache')
                self.send_header('Expires', '0')
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(f'Error reading index.html: {e}'.encode())
            return

        # Everything else served normally
        super().do_GET()

    def do_POST(self):
        global is_killed

        # Kill switch
        if self.path == '/api/bot/kill':
            is_killed = not is_killed
            print(f'  [kill switch] {"KILLED" if is_killed else "ACTIVE"}')
            send_json(self, {'killed': is_killed})
            return

        # Stop a match
        stop_match = re.match(r'^/api/matches/([^/]+)/stop$', self.path)
        if stop_match:
            match_id = stop_match.group(1)
            match = next((m for m in DEMO_MATCHES if m['match_id'] == match_id), None)
            if match:
                match['status'] = 'stopped'
                match['updated_at'] = datetime.now().isoformat()
                print(f'  [stop] {match["name"]}')
            send_json(self, {'success': True})
            return

        # Resume a match
        resume_match = re.match(r'^/api/matches/([^/]+)/resume$', self.path)
        if resume_match:
            match_id = resume_match.group(1)
            match = next((m for m in DEMO_MATCHES if m['match_id'] == match_id), None)
            if match:
                match['status'] = 'chatting'
                match['updated_at'] = datetime.now().isoformat()
                print(f'  [resume] {match["name"]}')
            send_json(self, {'success': True})
            return

        # Approve date
        approve_match = re.match(r'^/api/matches/([^/]+)/approve-date$', self.path)
        if approve_match:
            match_id = approve_match.group(1)
            match = next((m for m in DEMO_MATCHES if m['match_id'] == match_id), None)
            if match:
                match['status'] = 'date_confirmed'
                match['updated_at'] = datetime.now().isoformat()
                print(f'  [date approved] {match["name"]}')
            send_json(self, {'success': True})
            return

        # Reject date
        reject_match = re.match(r'^/api/matches/([^/]+)/reject-date$', self.path)
        if reject_match:
            match_id = reject_match.group(1)
            match = next((m for m in DEMO_MATCHES if m['match_id'] == match_id), None)
            if match:
                match['status'] = 'date_rejected'
                match['updated_at'] = datetime.now().isoformat()
                print(f'  [date rejected] {match["name"]}')
            send_json(self, {'success': True})
            return

        # Toggle auto-messaging per match
        auto_match = re.match(r'^/api/matches/([^/]+)/auto-messaging$', self.path)
        if auto_match:
            match_id = auto_match.group(1)
            match = next((m for m in DEMO_MATCHES if m['match_id'] == match_id), None)
            if match:
                match['auto_messaging'] = not match['auto_messaging']
                print(f'  [auto-msg] {match["name"]}: {"ON" if match["auto_messaging"] else "OFF"}')
            send_json(self, {'success': True, 'auto_messaging': match['auto_messaging'] if match else False})
            return

        # Send message
        send_match = re.match(r'^/api/matches/([^/]+)/send$', self.path)
        if send_match:
            match_id = send_match.group(1)
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            message = body.get('message', '')
            match = next((m for m in DEMO_MATCHES if m['match_id'] == match_id), None)
            if match and message:
                match['messages_sent'] += 1
                match['updated_at'] = datetime.now().isoformat()
                match['last_message_at'] = datetime.now().isoformat()
                if match_id not in DEMO_CONVERSATIONS:
                    DEMO_CONVERSATIONS[match_id] = []
                DEMO_CONVERSATIONS[match_id].append({
                    "role": "assistant",
                    "content": message,
                    "timestamp": datetime.now().isoformat()
                })
                print(f'  [sent] to {match["name"]}: {message[:50]}...')
            send_json(self, {'success': True})
            return

        send_json(self, {'error': 'not found'}, 404)

    def log_message(self, format, *args):
        status = str(args[1]) if len(args) > 1 else ''
        if status.startswith('4') or status.startswith('5'):
            super().log_message(format, *args)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """Handle each request in a new thread so live reload doesn't block."""
    daemon_threads = True
    allow_reuse_address = True


def main():
    pull_thread = threading.Thread(target=git_pull_loop, daemon=True)
    pull_thread.start()

    print()
    print('=' * 50)
    print('  LIVE DEV SERVER + DEMO MODE')
    print(f'  http://localhost:{PORT}')
    print()
    print(f'  {len(DEMO_MATCHES)} simulated profiles loaded')
    print('  Auto-pulls from git every 5s')
    print('  Auto-reloads browser on changes')
    print()
    print('  Just leave this running!')
    print('=' * 50)
    print()

    try:
        server = ThreadedHTTPServer(('', PORT), DevHandler)
    except OSError as e:
        if 'Address already in use' in str(e) or getattr(e, 'errno', 0) == 98:
            print(f'ERROR: Port {PORT} is already in use!')
            print(f'Kill the old server first:')
            print(f'  Mac/Linux: lsof -ti:{PORT} | xargs kill')
            print(f'Then try again: python3 dev.py')
            sys.exit(1)
        raise

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
        server.shutdown()


if __name__ == '__main__':
    main()
