import re
from typing import Dict
from indic_transliteration import sanscript
from indic_transliteration.sanscript import transliterate
from deep_translator import GoogleTranslator, MyMemoryTranslator

# High-frequency conversational Hindi, Hinglish, & English loanword vocabulary mapping
HINDI_SPECIAL_MAP = {
    # Pronouns, Conjunctions & Particles
    'में': 'mein', 'हैं': 'hain', 'है': 'hai', 'हो': 'ho', 'था': 'tha', 'थी': 'thi', 'थे': 'the',
    'वो': 'woh', 'ये': 'yeh', 'तो': 'toh', 'जो': 'jo', 'को': 'ko', 'से': 'se', 'के': 'ke',
    'की': 'ki', 'का': 'ka', 'पर': 'par', 'और': 'aur', 'या': 'ya', 'भी': 'bhi', 'ही': 'hi',
    'ने': 'ne', 'तूने': 'tune', 'मैंने': 'maine', 'हमने': 'humne', 'उन्होंने': 'unhone',
    'आप': 'aap', 'तुम': 'tum', 'तू': 'tu', 'हम': 'hum', 'मेरा': 'mera', 'मेरी': 'meri', 'मेरे': 'mere',
    'तेरा': 'tera', 'तेरी': 'teri', 'तेरे': 'tere', 'आपका': 'aapka', 'आपकी': 'aapki', 'आपके': 'aapke',
    'गया': 'gaya', 'गयी': 'gayi', 'गए': 'gaye', 'लगा': 'laga', 'लगी': 'lagi', 'लगे': 'lage',
    'तक': 'tak', 'बट': 'but', 'ज़्यादा': 'zyada', 'ज्यादा': 'zyada', 'कम': 'kam',
    
    # Greetings & Common Expressions
    'हाय': 'hi', 'हैलो': 'hello', 'हेलो': 'hello', 'ब्रो': 'bro', 'भाई': 'bhai', 'भैया': 'bhaiya', 'यार': 'yaar',
    'दोस्त': 'dost', 'सर': 'sir', 'मैडम': 'madam',
    'कैसा': 'kaisa', 'कैसे': 'kaise', 'कैसी': 'kaisi', 'क्या': 'kya', 'क्यों': 'kyun',
    'सब': 'sab', 'कुछ': 'kuch', 'चल': 'chal', 'रहा': 'raha', 'रही': 'rahi', 'रहे': 'rahe',
    'देखा': 'dekha', 'देखी': 'dekhi', 'देखे': 'dekhe', 'करना': 'karna', 'किया': 'kiya',
    'अच्छा': 'achha', 'बुरा': 'bura', 'नहीं': 'nahi', 'नही': 'nahi', 'बात': 'baat', 'लोग': 'log',
    'ठीक': 'theek', 'बस': 'bas', 'हां': 'haan', 'हाँ': 'haan', 'लिए': 'liye', 'ले': 'liye',
    'काफ़ी': 'kaafi', 'काफी': 'kaafi', 'पड़ा': 'pada', 'पड़ी': 'padi', 'पड़े': 'pade',

    # Conversational English Words (Common in STT Code-Mixing)
    'हाउ': 'how', 'हव': 'how', 'इज़': 'is', 'इज': 'is', 'आर': 'are', 'यू': 'you', 'एम': 'am',
    'व्हाट': 'what', 'व्हेन': 'when', 'वेयर': 'where', 'हू': 'who', 'वाय': 'why', 'विच': 'which',
    'डू': 'do', 'डिड': 'did', 'डन': 'done', 'कैन': 'can', 'कुड': 'could', 'विल': 'will', 'वुड': 'would',
    'एवरीथिंग': 'everything', 'गोइंग': 'going', 'कमिंग': 'coming', 'डूइंग': 'doing',
    'ऑल': 'all', 'राइट': 'right', 'ऑलराइट': 'alright',
    'कॉल': 'call', 'कौल': 'call', 'टाइम': 'time', 'मनी': 'money', 'पेमेंट': 'payment', 'ऑर्डर': 'order',
    'प्रॉब्लम': 'problem', 'प्रोब्लम': 'problem', 'प्रोब्लॉम': 'problem', 'इशू': 'issue',
    'रिज़ॉल्व': 'resolve', 'रिसॉल्व': 'resolve', 'एंड': 'end', 'एंट': 'end',
    'हेल्प': 'help', 'सपोर्ट': 'support', 'सर्विस': 'service', 'कस्टमर': 'customer',
    'अकाउंट': 'account', 'प्लीज': 'please', 'थैंक': 'thank', 'थैंक्स': 'thanks', 'थैंक्यू': 'thank you',
    'ओके': 'okay', 'यस': 'yes', 'नो': 'no', 'सॉरी': 'sorry',
    'गोस्ट': 'ghost', 'गॉस्ट': 'ghost', 'भूकॉंग': 'wukong', 'बुकॉंग': 'wukong', 'वूकॉंग': 'wukong', 'भुपॉंग': 'wukong',
    'गेमप्ले': 'gameplay', 'गेमपली': 'gameplay', 'गेम': 'game', 'प्ले': 'play',
    'एक्सपीरिएंस': 'experience', 'ओवरऑल': 'overall', 'रिफ़ंड': 'refund', 'रिफंड': 'refund',
    'वेट': 'wait', 'कैंसिल': 'cancel', 'अपडेट': 'update', 'चेक': 'check', 'स्टार्ट': 'start', 'स्टॉप': 'stop',
    'डिटेल्स': 'details', 'नंबर': 'number', 'मैसेज': 'message', 'ओटीपी': 'otp',
    'ऐप': 'app', 'वेबसाइट': 'website', 'लिंक': 'link', 'ऑनलाइन': 'online', 'ऑफलाइन': 'offline',
    'इंटरनेट': 'internet', 'नेटवर्क': 'network', 'डिवाइस': 'device', 'फोन': 'phone', 'मोबाइल': 'mobile', 'लैपटॉप': 'laptop'
}

def to_romanised_hinglish(text: str) -> str:
    """
    Converts Devanagari Hindi / Hinglish text into natural Romanised English (Latin script).
    Applies loanword normalization, proper matra mapping, and Hindi schwa syncope rules.
    """
    if not text or not text.strip():
        return ""

    # Replace loanword vowels with proper Devanagari vowel signs (matras) so ITRANS doesn't insert split consonants
    text_clean = text.replace('ॉ', 'ो').replace('ऑ', 'ओ').replace('ॅ', 'े').replace('ऍ', 'ए')
    text_clean = re.sub(r'ोफ\b', 'of', text_clean)

    tokens = text_clean.split()
    res = []

    for token in tokens:
        # Separate punctuation
        m = re.match(r'^([^\w\u0900-\u097F]*)([\w\u0900-\u097F]+)([^\w\u0900-\u097F]*)$', token)
        if not m:
            res.append(token)
            continue

        prefix, word, suffix = m.groups()

        # 1. Exact match in special vocabulary & loanword map
        if word in HINDI_SPECIAL_MAP:
            res.append(prefix + HINDI_SPECIAL_MAP[word] + suffix)
            continue

        # 2. If already English / Latin characters, keep as is
        if re.match(r'^[a-zA-Z0-9]+$', word):
            res.append(prefix + word + suffix)
            continue

        # 3. Transliterate Devanagari word using ITRANS
        rom = transliterate(word, sanscript.DEVANAGARI, sanscript.ITRANS)

        # Convert ITRANS academic notation to conversational Romanised Hindi
        rom = rom.replace('~N', 'n').replace('.n', 'n').replace('M', 'n').replace('~n', 'n')
        rom = rom.replace('aa', 'a').replace('ii', 'ee').replace('uu', 'oo')
        rom = rom.replace('RRi', 'ri').replace('Sh', 'sh').replace('shh', 'sh')
        rom = rom.replace('Th', 'th').replace('Dh', 'dh').replace('ph', 'f')
        rom = rom.replace('.d', 'd').replace('.D', 'd').replace('.a', '').replace('a.n', 'an')
        
        rom = rom.lower()

        # Hindi Schwa syncope: trailing 'a' after consonants in Hindi is silent
        has_aa_matra = word.endswith(('ा', 'आ', 'या', 'हा', 'था', 'ता', 'ना', 'सा', 'ड़ा', 'ढ़ा'))
        if not has_aa_matra and rom.endswith('a') and len(rom) > 2 and not rom.endswith(('kya', 'tha', 'bha', 'tra', 'kripa')):
            rom = rom[:-1]

        res.append(prefix + rom + suffix)

    return " ".join(res)

def to_english_translation(text: str) -> str:
    """
    Translates Hindi / Hinglish text into standard English with automatic fallback.
    """
    if not text or not text.strip():
        return ""

    cleaned_text = text.strip()

    # Short single-word edge cases
    if cleaned_text in ["है", "हैं", "हो", "था", "थी", "the"]:
        return "is / are / was"

    # Primary: GoogleTranslator
    try:
        translated = GoogleTranslator(source='auto', target='en').translate(cleaned_text)
        if translated and not translated.startswith("Error") and "500" not in translated and "<html" not in translated:
            return translated.strip()
    except Exception:
        pass

    # Secondary fallback: MyMemory
    try:
        fallback = MyMemoryTranslator(source='hi-IN', target='en-GB').translate(cleaned_text)
        if fallback and not fallback.startswith("Error") and "<html" not in fallback:
            return fallback.strip()
    except Exception:
        pass

    return cleaned_text

def format_speech_output(raw_transcript: str) -> Dict[str, str]:
    """
    Takes raw transcript and returns the 3 modalities:
    1. devanagari: Hindi script
    2. romanised: Romanized Hinglish English script
    3. english: English translation
    """
    if not raw_transcript or not raw_transcript.strip():
        return {
            "transcript": "",
            "devanagari": "",
            "romanised": "",
            "english": ""
        }

    devanagari_text = raw_transcript.strip()
    romanised_text = to_romanised_hinglish(devanagari_text)
    english_translation = to_english_translation(devanagari_text)

    return {
        "transcript": devanagari_text,
        "devanagari": devanagari_text,
        "romanised": romanised_text,
        "english": english_translation
    }
