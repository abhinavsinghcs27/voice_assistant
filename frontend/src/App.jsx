import React, { useState, useRef, useEffect } from 'react';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('assistant'); // 'assistant' or 'benchmark'

  // Common State
  const [models, setModels] = useState([]);
  const [error, setError] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  // Benchmark State
  const [selectedModels, setSelectedModels] = useState([]);
  const [bmRecording, setBmRecording] = useState(false);
  const [bmTimer, setBmTimer] = useState(0);
  const [bmAudioBlob, setBmAudioBlob] = useState(null);
  const [bmAudioUrl, setBmAudioUrl] = useState(null);
  const [bmAudioName, setBmAudioName] = useState('');
  const [bmLoading, setBmLoading] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState(null);

  // Voice Assistant State
  const [sttModel, setSttModel] = useState('groq-whisper-large-v3-turbo');
  const [vaTimer, setVaTimer] = useState(0);

  // Continuous Call State
  const [vaCallActive, setVaCallActive] = useState(false);
  const [vaPhase, setVaPhase] = useState('idle'); // 'idle' | 'greeting' | 'listening' | 'processing' | 'speaking' | 'ended'
  const [vaGreeting, setVaGreeting] = useState('');
  const [structuredFeedback, setStructuredFeedback] = useState(null);
  
  // Multi-Turn & Telemetry State
  const [vaSessionId, setVaSessionId] = useState(null);
  const [vaTurns, setVaTurns] = useState([]);
  const [vaTelemetry, setVaTelemetry] = useState({
    sentiment: 'neutral',
    sentiment_score: 0.0,
    csat_estimate: 3,
    detected_intent: 'General Inquiry',
    human_escalation_flag: false
  });

  // Refs
  const bmMediaRecorderRef = useRef(null);
  const bmAudioChunksRef = useRef([]);
  const bmTimerRef = useRef(null);
  const bmFileInputRef = useRef(null);

  const vaMediaRecorderRef = useRef(null);
  const vaAudioChunksRef = useRef([]);
  const vaTimerRef = useRef(null);

  // Continuous Call Refs
  const vaStreamRef = useRef(null);
  const vaAudioCtxRef = useRef(null);
  const vaAnalyserRef = useRef(null);
  const vaSilenceTimerRef = useRef(null);
  const vaSilenceStartRef = useRef(null);
  const vaGreetAudioRef = useRef(null);
  const vaLiveAudioRef = useRef(null);
  const vaCallActiveRef = useRef(false);
  const vaPhaseRef = useRef('idle');
  const vaSessionIdRef = useRef(null);
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [vaTurns, vaGreeting, vaPhase]);

  useEffect(() => {
    fetch('/api/models')
      .then((res) => {
        if (!res.ok) throw new Error("Could not fetch models");
        return res.json();
      })
      .then((data) => {
        setModels(data);
        setSelectedModels(data.map(m => m.id));
      })
      .catch((err) => {
        console.error(err);
        setError("Failed to connect to backend STT service at http://127.0.0.1:8000.");
      });
  }, []);

  // --- Copy Helper ---
  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  // Continuous Call: mirror state into refs for event handlers + cleanup on unmount
  useEffect(() => { vaCallActiveRef.current = vaCallActive; }, [vaCallActive]);
  useEffect(() => { vaPhaseRef.current = vaPhase; }, [vaPhase]);
  useEffect(() => { vaSessionIdRef.current = vaSessionId; }, [vaSessionId]);
  useEffect(() => {
    return () => {
      if (vaSilenceTimerRef.current) clearInterval(vaSilenceTimerRef.current);
      if (vaStreamRef.current) vaStreamRef.current.getTracks().forEach((t) => t.stop());
      if (vaAudioCtxRef.current && vaAudioCtxRef.current.state === 'running') vaAudioCtxRef.current.close();
    };
  }, []);

  // ==========================================
  // 1. BENCHMARK LOGIC
  // ==========================================
  const toggleModelSelection = (id) => {
    setSelectedModels(prev => 
      prev.includes(id) 
        ? prev.length > 1 ? prev.filter(m => m !== id) : prev 
        : [...prev, id]
    );
  };

  const startBmRecording = async () => {
    setError(null);
    setBenchmarkData(null);
    bmAudioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';

      bmMediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      bmMediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) bmAudioChunksRef.current.push(e.data);
      };
      bmMediaRecorderRef.current.onstop = () => {
        const blob = new Blob(bmAudioChunksRef.current, { type: mimeType });
        setBmAudioBlob(blob);
        setBmAudioUrl(URL.createObjectURL(blob));
        setBmAudioName(`mic_bm_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.webm`);
      };

      bmMediaRecorderRef.current.start();
      setBmRecording(true);
      setBmTimer(0);
      bmTimerRef.current = setInterval(() => setBmTimer(prev => prev + 1), 1000);
    } catch (err) {
      console.error(err);
      setError("Microphone access denied or audio device not found.");
    }
  };

  const stopBmRecording = () => {
    if (bmMediaRecorderRef.current && bmRecording) {
      bmMediaRecorderRef.current.stop();
      bmMediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      clearInterval(bmTimerRef.current);
      setBmRecording(false);
    }
  };

  const handleBmFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);
    setBenchmarkData(null);
    setBmAudioBlob(file);
    setBmAudioUrl(URL.createObjectURL(file));
    setBmAudioName(file.name);
  };

  const discardBmAudio = () => {
    if (bmAudioUrl) URL.revokeObjectURL(bmAudioUrl);
    setBmAudioBlob(null);
    setBmAudioUrl(null);
    setBmAudioName('');
    setBenchmarkData(null);
    setBmTimer(0);
    if (bmFileInputRef.current) bmFileInputRef.current.value = '';
  };

  const runBenchmark = async () => {
    if (!bmAudioBlob) {
      setError("No audio recording or file selected.");
      return;
    }
    if (selectedModels.length === 0) {
      setError("Please select at least one model to benchmark.");
      return;
    }

    setBmLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('audio', bmAudioBlob, bmAudioName || 'recording.webm');
    formData.append('models', selectedModels.join(','));

    try {
      const response = await fetch('/api/benchmark', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Benchmark execution failed.');
      }

      const data = await response.json();
      setBenchmarkData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBmLoading(false);
    }
  };

  // ==========================================
  // 2. VOICE ASSISTANT LOGIC (STT -> LLM -> TTS)
  // ==========================================

  // ==========================================
  // 3. CONTINUOUS CALL LOOP (hands-free)
  // ==========================================
  const playResponseAudio = (dataUrl) => {
    const el = vaLiveAudioRef.current;
    if (el && dataUrl) {
      el.src = dataUrl;
      el.play().catch((e) => console.log("Autoplay prevented by browser:", e));
    }
  };

  const stopSilenceMonitor = () => {
    if (vaSilenceTimerRef.current) {
      clearInterval(vaSilenceTimerRef.current);
      vaSilenceTimerRef.current = null;
    }
  };

  const stopMicTracks = () => {
    if (vaStreamRef.current) {
      vaStreamRef.current.getTracks().forEach((t) => t.stop());
      vaStreamRef.current = null;
    }
  };

  const setupAnalyser = (stream) => {
    if (!vaAudioCtxRef.current) {
      vaAudioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = vaAudioCtxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    vaAnalyserRef.current = analyser;
  };

  const startCall = async () => {
    setError(null);
    setStructuredFeedback(null);
    setVaGreeting('');
    setVaTurns([]);
    setVaSessionId(null);
    vaSessionIdRef.current = null;
    try {
      if (!vaStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        vaStreamRef.current = stream;
        setupAnalyser(stream);
      }
      setVaCallActive(true);
      startGreeting();
    } catch (err) {
      console.error(err);
      setError("Microphone access denied or audio device not found.");
    }
  };

  const startGreeting = async () => {
    setVaPhase('greeting');
    setVaTurns([]);
    try {
      const res = await fetch('/api/voice-assistant/greet', { method: 'POST' });
      if (!res.ok) {
        const ed = await res.json();
        throw new Error(ed.detail || 'Greeting failed.');
      }
      const data = await res.json();
      setVaGreeting(data.text);
      const el = vaGreetAudioRef.current;
      if (el && data.audio_url) {
        el.src = data.audio_url;
        el.play().catch((e) => console.log("Greeting autoplay blocked:", e));
      } else {
        startListening();
      }
    } catch (err) {
      setError(err.message);
      setVaCallActive(false);
      setVaPhase('idle');
      stopMicTracks();
    }
  };

  const startListening = () => {
    if (!vaCallActiveRef.current || !vaStreamRef.current) return;
    vaAudioChunksRef.current = [];
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(vaStreamRef.current, { mimeType });
      vaMediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) vaAudioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(vaAudioChunksRef.current, { type: mimeType });
        vaAudioChunksRef.current = [];
        if (vaCallActiveRef.current) submitTurn(blob);
      };
      recorder.start();
      setVaPhase('listening');
      setVaTimer(0);
      vaTimerRef.current = setInterval(() => setVaTimer((prev) => prev + 1), 1000);
      startSilenceMonitor();
    } catch (err) {
      console.error(err);
      setError("Could not start recording.");
    }
  };

  const startSilenceMonitor = () => {
    stopSilenceMonitor();
    vaSilenceStartRef.current = null;
    vaSilenceTimerRef.current = setInterval(() => {
      const analyser = vaAnalyserRef.current;
      if (!analyser) return;
      const buf = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      if (rms < 0.02) {
        if (vaSilenceStartRef.current === null) {
          vaSilenceStartRef.current = Date.now();
        } else if (Date.now() - vaSilenceStartRef.current >= 1500) {
          stopAndSubmitTurn();
        }
      } else {
        vaSilenceStartRef.current = null;
      }
    }, 250);
  };

  const stopAndSubmitTurn = () => {
    stopSilenceMonitor();
    clearInterval(vaTimerRef.current);
    const recorder = vaMediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      setVaPhase('processing');
      recorder.stop();
    }
  };

  const submitTurn = async (blob) => {
    if (!vaCallActiveRef.current) return;
    setVaPhase('processing');
    const formData = new FormData();
    formData.append('audio', blob, `turn_${Date.now()}.webm`);
    formData.append('stt_model', sttModel);
    if (vaSessionIdRef.current) formData.append('session_id', vaSessionIdRef.current);

    try {
      const response = await fetch('/api/voice-assistant/interact', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Voice turn processing failed.');
      }
      const data = await response.json();
      vaSessionIdRef.current = data.session_id;
      setVaSessionId(data.session_id);
      if (data.telemetry) setVaTelemetry(data.telemetry);

      const newTurn = {
        id: data.id,
        user_transcript: data.user_transcript,
        llm_response: data.llm_response,
        audio_url: data.audio_url,
        latency: data.latency,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
      setVaTurns((prev) => [...prev, newTurn]);
      setVaPhase('speaking');
      playResponseAudio(data.audio_url);
    } catch (err) {
      setError(err.message);
      if (vaCallActiveRef.current) startListening();
    }
  };

  const handleLiveAudioEnded = () => {
    if (vaCallActiveRef.current && vaPhaseRef.current === 'speaking') {
      setTimeout(() => startListening(), 400);
    }
  };

  const handleGreetAudioEnded = () => {
    if (vaCallActiveRef.current) startListening();
  };

  const endCall = async () => {
    stopSilenceMonitor();
    clearInterval(vaTimerRef.current);
    const recorder = vaMediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    vaCallActiveRef.current = false;
    setVaCallActive(false);
    setVaPhase('speaking');
    stopMicTracks();
    await finalizeSession();
  };

  const finalizeSession = async () => {
    if (!vaSessionIdRef.current) {
      setError("No active conversation to finalize.");
      return;
    }
    try {
      const formData = new FormData();
      formData.append('session_id', vaSessionIdRef.current);
      const res = await fetch('/api/voice-assistant/finalize', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Finalize failed.');
      }
      const data = await res.json();
      setStructuredFeedback(data.structured_feedback);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="app-container">
      {/* Header Section */}
      <header className="header-section">
        <span className="header-badge">Vaani AI • Real-Time Voice Intelligence</span>
        <h1 className="app-title">Vaani AI</h1>
        <p className="app-subtitle">
          Real-time Hindi & Hinglish conversational voice AI assistant with sub-second latency, Groq LLM reasoning, and multi-model STT benchmarking.
        </p>

        {/* Tab Selector */}
        <div className="tab-bar">
          <button 
            className={`tab-btn ${activeTab === 'assistant' ? 'active' : ''}`}
            onClick={() => setActiveTab('assistant')}
          >
            🎙️ Vaani AI Voice Assistant
          </button>
          <button 
            className={`tab-btn ${activeTab === 'benchmark' ? 'active' : ''}`}
            onClick={() => setActiveTab('benchmark')}
          >
            📊 STT Benchmark Comparison
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span>⚠️</span> {error}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 1: VOICE ASSISTANT PIPELINE (MULTI-TURN + TELEMETRY) */}
      {/* ==================================================================== */}
      {activeTab === 'assistant' && (
        <div className="tab-content">
          {/* Session Header Bar */}
          <div className="session-bar">
            <div className="session-info">
              <span>💬 Session Context:</span>
              <span className="session-badge">{vaSessionId || 'New Session'}</span>
              <span>• Turns: <strong>{vaTurns.length}</strong></span>
              {vaCallActive && <span className="call-live-tag">🟢 Call Live</span>}
            </div>
            {vaCallActive && (
              <button className="btn-reset-session end-call-btn" onClick={endCall}>
                🔴 End Call
              </button>
            )}
          </div>

          {/* Controls & Engine Selection */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <span>⚡</span> Pipeline Engine Settings
              </div>
              <span className="section-hint">STT Model + Groq LLM + Edge-TTS</span>
            </div>

            <div className="assistant-settings-grid">
              <div className="setting-box">
                <label className="setting-label">Speech Recognition (STT)</label>
                <select 
                  className="setting-select"
                  value={sttModel}
                  onChange={(e) => setSttModel(e.target.value)}
                  disabled={vaCallActive}
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id === 'groq-whisper-large-v3-turbo' ? '☁️ (Cloud GPU)' : m.id === 'indic-conformer-onnx' ? '⚡ (Sub-200ms CPU)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="setting-box">
                <label className="setting-label">LLM Engine (Reasoning)</label>
                <div className="static-badge-box">
                  🤖 <strong>Groq openai/gpt-oss-20b</strong> <span className="speed-tag">Multi-Turn Context</span>
                </div>
              </div>

              <div className="setting-box">
                <label className="setting-label">Voice Synthesis (TTS)</label>
                <div className="static-badge-box">
                  🔊 <strong>Edge-TTS Natural Neural Voice</strong> <span className="speed-tag">Hi-IN / En-IN</span>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Audio Capture Card */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <span>🎙️</span> {vaCallActive ? 'Call In Progress' : 'Voice Call'}
              </div>
              <span className="section-hint">
                {vaCallActive
                  ? '🔄 Hands-free — mic auto-starts after the AI finishes speaking'
                  : 'Start a call to begin collecting feedback'}
              </span>
            </div>

            {/* Idle — Start Call (the only button here) */}
            {!vaCallActive && (
              <div className="audio-capture-box">
                <div className="btn-group">
                  <button className="btn btn-primary btn-start-call" onClick={startCall}>
                    <span>▶️</span> Start Call
                  </button>
                </div>
              </div>
            )}

            {/* Greeting phase */}
            {vaCallActive && vaPhase === 'greeting' && (
              <div className="status-box">
                <div className="mic-circle speaking">👋</div>
                <p className="status-text">{vaGreeting || 'Greeting...'}</p>
                <audio ref={vaGreetAudioRef} onEnded={handleGreetAudioEnded} style={{ display: 'none' }} />
              </div>
            )}

            {/* Listening phase — user is speaking */}
            {vaCallActive && vaPhase === 'listening' && (
              <div className="audio-capture-box">
                <div className="mic-circle recording">⏺️</div>
                <div className="recording-timer">{formatTime(vaTimer)}</div>
                <div className="listening-hint">🗣️ Listening… speak now — turn auto-submits after 1.5s of silence</div>
              </div>
            )}

            {/* Processing / Speaking phases */}
            {(vaCallActive && (vaPhase === 'processing' || vaPhase === 'speaking')) && (
              <div className="status-box">
                <div className={vaPhase === 'processing' ? 'cs-spinner' : 'mic-circle speaking'}>
                  {vaPhase === 'processing' ? '⚙️' : '🔊'}
                </div>
                <p className="status-text">
                  {vaPhase === 'processing'
                    ? 'Processing turn (STT → LLM → TTS)…'
                    : 'Assistant speaking… mic will auto-start after.'}
                </p>
                <audio ref={vaLiveAudioRef} onEnded={handleLiveAudioEnded} style={{ display: 'none' }} />
              </div>
            )}
          </div>

          {/* Real-Time Sentiment & Telemetry Dashboard */}
          {vaTurns.length > 0 && (
            <div className="telemetry-card">
              <div className="section-header">
                <div className="section-title">
                  <span>📊</span> Real-Time Session Telemetry & Sentiment Dashboard
                </div>
                <span className="section-hint">Post-Call Telemetry Extraction</span>
              </div>

              <div className="telemetry-grid">
                <div className="telemetry-item">
                  <span className="telemetry-label">Detected Sentiment</span>
                  <div className={`sentiment-badge ${vaTelemetry.sentiment}`}>
                    {vaTelemetry.sentiment === 'positive' && '🟢 Positive'}
                    {vaTelemetry.sentiment === 'neutral' && '🟡 Neutral'}
                    {vaTelemetry.sentiment === 'frustrated' && '🔴 Frustrated Customer'}
                  </div>
                </div>

                <div className="telemetry-item">
                  <span className="telemetry-label">Estimated CSAT Rating</span>
                  <div className="csat-stars">
                    {'★'.repeat(vaTelemetry.csat_estimate)}{'☆'.repeat(5 - vaTelemetry.csat_estimate)}
                    <span style={{ fontSize: '0.85rem', color: '#94a3b8', marginLeft: '0.5rem' }}>
                      ({vaTelemetry.csat_estimate}/5)
                    </span>
                  </div>
                </div>

                <div className="telemetry-item">
                  <span className="telemetry-label">Detected Customer Intent</span>
                  <div className="intent-tag">
                    🏷️ {vaTelemetry.detected_intent}
                  </div>
                </div>

                <div className="telemetry-item">
                  <span className="telemetry-label">Human Escalation Status</span>
                  <div style={{ fontSize: '0.9rem', fontWeight: '700', color: vaTelemetry.human_escalation_flag ? '#f87171' : '#34d399' }}>
                    {vaTelemetry.human_escalation_flag ? '⚠️ Escalation Flagged' : '✅ Handled by Voice AI'}
                  </div>
                </div>
              </div>

              {vaTelemetry.human_escalation_flag && (
                <div className="escalation-banner">
                  <span>⚠️</span> <strong>Escalation Warning:</strong> High frustration or explicit human agent request detected. Flagged for Razorpay Support CRM routing.
                </div>
              )}
            </div>
          )}

          {/* Full-Conversation Chat Transcript */}
          {(vaTurns.length > 0 || vaGreeting) && (
            <div className="card chat-card">
              <div className="section-header">
                <div className="section-title">
                  <span>💬</span> Conversation
                </div>
                <span className="section-hint">Full call transcript in chat form</span>
              </div>

              <div className="chat-container" ref={chatRef}>
                {vaGreeting && (
                  <div className="chat-msg assistant">
                    <div className="chat-bubble">
                      <div className="chat-meta">
                        <span className="chat-name">Vaani</span>
                      </div>
                      <div className="chat-text">{vaGreeting}</div>
                    </div>
                  </div>
                )}

                {vaTurns.map((turn, idx) => (
                  <div className="chat-turn" key={turn.id || idx}>
                    {/* User */}
                    <div className="chat-msg user">
                      <div className="chat-bubble">
                        <div className="chat-meta">
                          <span className="chat-name">You</span>
                          <span className="chat-time">{turn.timestamp}</span>
                        </div>
                        <div className="chat-text devanagari-text">
                          {turn.user_transcript.devanagari || turn.user_transcript.raw || '(No speech recognized)'}
                        </div>
                        {turn.user_transcript.romanised && (
                          <div className="chat-sub">🔤 {turn.user_transcript.romanised}</div>
                        )}
                        {turn.user_transcript.english && (
                          <div className="chat-sub">🌐 {turn.user_transcript.english}</div>
                        )}
                        {turn.latency && (
                          <div className="chat-latency">
                            ⚡ {turn.latency.total_seconds}s total (STT {turn.latency.stt_seconds}s · LLM {turn.latency.llm_seconds}s · TTS {turn.latency.tts_seconds}s)
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Assistant */}
                    <div className="chat-msg assistant">
                      <div className="chat-bubble">
                        <div className="chat-meta">
                          <span className="chat-name">Vaani <span className="chat-model">({turn.llm_response.model_used})</span></span>
                          <span className="chat-time">{turn.timestamp}</span>
                        </div>
                        <div className="chat-text">"{turn.llm_response.text}"</div>
                        {turn.audio_url && (
                          <div className="chat-audio">
                            <audio controls src={turn.audio_url} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Post-Call Feedback Report (Phase 2) */}
          {structuredFeedback && (
            <div className="report-card">
              <div className="section-header">
                <div className="section-title">
                  <span>📋</span> Post-Call Feedback Report
                </div>
                <span className="report-saved-hint">
                  💾 Saved: backend/post-call-analysis/{structuredFeedback.record_id || ''}_feedback.json
                </span>
              </div>

              <div className="report-grid">
                <div className="report-item">
                  <span className="report-label">Overall Sentiment</span>
                  <div className={`sentiment-badge ${structuredFeedback.aggregate_sentiment || 'neutral'}`}>
                    {structuredFeedback.aggregate_sentiment || 'neutral'}
                  </div>
                </div>

                <div className="report-item">
                  <span className="report-label">Satisfaction Rating</span>
                  <div className="csat-stars">
                    {'★'.repeat(structuredFeedback.overall_satisfaction)}{'☆'.repeat(5 - structuredFeedback.overall_satisfaction)}
                    <span style={{ fontSize: '0.85rem', color: '#94a3b8', marginLeft: '0.5rem' }}>
                      ({structuredFeedback.overall_satisfaction}/5)
                    </span>
                  </div>
                </div>

                <div className="report-item">
                  <span className="report-label">Resolution Status</span>
                  <div className="intent-tag">
                    {structuredFeedback.resolution_status || 'resolved'}
                    {structuredFeedback.follow_up_required ? ' • ⚠️ Follow-up required' : ''}
                  </div>
                </div>
              </div>

              <div className="report-columns">
                <div className="report-column">
                  <div className="report-col-title">⚠️ Complaints</div>
                  <ul className="report-list">
                    {(structuredFeedback.primary_complaints && structuredFeedback.primary_complaints.length)
                      ? structuredFeedback.primary_complaints.map((c, i) => <li key={i}>{c}</li>)
                      : <li className="report-empty">None recorded</li>}
                  </ul>
                </div>

                <div className="report-column">
                  <div className="report-col-title">✅ Positive Highlights</div>
                  <ul className="report-list">
                    {(structuredFeedback.positive_highlights && structuredFeedback.positive_highlights.length)
                      ? structuredFeedback.positive_highlights.map((c, i) => <li key={i}>{c}</li>)
                      : <li className="report-empty">None recorded</li>}
                  </ul>
                </div>

                <div className="report-column">
                  <div className="report-col-title">🎯 Action Items</div>
                  <ul className="report-list">
                    {(structuredFeedback.action_items && structuredFeedback.action_items.length)
                      ? structuredFeedback.action_items.map((c, i) => <li key={i}>{c}</li>)
                      : <li className="report-empty">None required</li>}
                  </ul>
                </div>
              </div>

              {structuredFeedback.key_topics && structuredFeedback.key_topics.length > 0 && (
                <div className="report-topics">
                  <span className="report-label">Key Topics:</span>{' '}
                  {structuredFeedback.key_topics.map((t, i) => (
                    <span className="topic-tag" key={i}>{t}</span>
                  ))}
                </div>
              )}

              <div className="report-summary">
                <p><strong>Summary (Hindi):</strong> {structuredFeedback.summary_hindi || '—'}</p>
                <p><strong>Summary (English):</strong> {structuredFeedback.summary_english || '—'}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: STT BENCHMARK COMPARISON */}
      {/* ==================================================================== */}
      {activeTab === 'benchmark' && (
        <div className="tab-content">
          {/* Model Selection Card */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <span>⚙️</span> Select Models to Compare
              </div>
              <span className="section-hint">
                {selectedModels.length} of {models.length} selected
              </span>
            </div>

            <div className="model-grid">
              {models.map((m) => {
                const isSelected = selectedModels.includes(m.id);
                return (
                  <label 
                    key={m.id} 
                    className={`model-checkbox-card ${isSelected ? 'selected' : ''}`}
                  >
                    <div className="model-card-top">
                      <span className="model-name">{m.name}</span>
                      <input
                        type="checkbox"
                        className="model-checkbox"
                        checked={isSelected}
                        onChange={() => toggleModelSelection(m.id)}
                        disabled={bmRecording || bmLoading}
                      />
                    </div>
                    <p className="model-desc">{m.description}</p>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Audio Capture Card */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <span>🎙️</span> Benchmark Audio Input
              </div>
              <span className="section-hint">Record from mic or upload audio file</span>
            </div>

            <div className="audio-capture-box">
              <div className={`mic-circle ${bmRecording ? 'recording' : ''}`}>
                {bmRecording ? '⏺️' : '🎙️'}
              </div>

              {bmRecording && (
                <div className="recording-timer">{formatTime(bmTimer)}</div>
              )}

              <div className="btn-group">
                {!bmRecording ? (
                  <>
                    <button
                      className="btn btn-record"
                      onClick={startBmRecording}
                      disabled={bmLoading}
                    >
                      <span>⏺️</span> {bmAudioUrl ? 'Record New Audio' : 'Record Audio'}
                    </button>

                    <label className="btn btn-upload-label" style={{ cursor: bmLoading ? 'not-allowed' : 'pointer' }}>
                      <span>📁</span> Upload Audio File
                      <input
                        ref={bmFileInputRef}
                        type="file"
                        accept="audio/*,.wav,.mp3,.webm,.m4a,.ogg"
                        style={{ display: 'none' }}
                        onChange={handleBmFileUpload}
                        disabled={bmLoading}
                      />
                    </label>
                  </>
                ) : (
                  <button className="btn btn-stop" onClick={stopBmRecording}>
                    <span>⏹️</span> Stop Recording
                  </button>
                )}
              </div>

              {/* Audio Preview & Action Bar */}
              {bmAudioUrl && !bmRecording && (
                <div className="audio-preview-box">
                  <div className="audio-preview-header">
                    <span>🎵 <strong>{bmAudioName || 'Audio Ready'}</strong></span>
                    <span>Ready to Benchmark</span>
                  </div>
                  
                  <audio controls src={bmAudioUrl} />

                  <div className="btn-group" style={{ marginTop: '0.75rem' }}>
                    <button
                      className="btn btn-primary"
                      onClick={runBenchmark}
                      disabled={bmLoading || selectedModels.length === 0}
                    >
                      <span>⚡</span> {bmLoading ? 'Transcribing Across Models...' : 'Start Transcribing & Compare'}
                    </button>

                    <button
                      className="btn btn-discard"
                      onClick={discardBmAudio}
                      disabled={bmLoading}
                    >
                      <span>🗑️</span> Discard Recording
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Loading Box */}
          {bmLoading && (
            <div className="loading-box">
              <div className="spinner"></div>
              <div><strong>Transcribing across selected models...</strong></div>
              <p style={{ fontSize: '0.85rem', color: '#93c5fd' }}>
                Running inference on models and formatting into Devanagari, Romanised, and English.
              </p>
            </div>
          )}

          {/* Benchmark Results */}
          {benchmarkData && (
            <div className="results-grid">
              <div className="results-meta-bar">
                <span>⏱️ Audio Duration: <strong>{benchmarkData.audio_duration}s</strong></span>
                <span>🤖 Evaluated Models: <strong>{benchmarkData.results.length}</strong></span>
              </div>

              {benchmarkData.results.map((res) => {
                const isFast = res.real_time_factor <= 0.2;
                return (
                  <div 
                    className={`result-card ${isFast ? 'fast-card' : 'accurate-card'}`} 
                    key={res.model_id}
                  >
                    <div className="result-card-header">
                      <div className="model-title-wrap">
                        <h3>{res.model_name}</h3>
                      </div>

                      <div className="metrics-badges">
                        <span className="badge badge-time">
                          ⏱️ {res.processing_time}s latency
                        </span>
                        <span className={`badge ${res.real_time_factor <= 1.0 ? 'badge-rtf-fast' : 'badge-rtf-slow'}`}>
                          RTF: {res.real_time_factor}x {isFast ? '⚡ Ultra-Fast' : ''}
                        </span>
                      </div>
                    </div>

                    <div className="output-modalities">
                      {/* Modality 1: Devanagari */}
                      <div className="modality-block">
                        <div className="modality-header">
                          <span className="modality-tag devanagari-tag">🕉️ Devanagari (Hindi Script)</span>
                          <button 
                            className="copy-btn"
                            onClick={() => copyToClipboard(res.devanagari || res.transcript, `${res.model_id}_dev`)}
                          >
                            {copiedKey === `${res.model_id}_dev` ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                        <div className="transcript-box devanagari-text">
                          {res.devanagari || res.transcript || '(No speech recognized)'}
                        </div>
                      </div>

                      {/* Modality 2: Romanised Hinglish */}
                      <div className="modality-block">
                        <div className="modality-header">
                          <span className="modality-tag romanised-tag">🔤 Romanised English (Hinglish)</span>
                          <button 
                            className="copy-btn"
                            onClick={() => copyToClipboard(res.romanised, `${res.model_id}_rom`)}
                          >
                            {copiedKey === `${res.model_id}_rom` ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                        <div className="transcript-box romanised-text">
                          {res.romanised || '(Transliteration not available)'}
                        </div>
                      </div>

                      {/* Modality 3: English Translation */}
                      <div className="modality-block">
                        <div className="modality-header">
                          <span className="modality-tag english-tag">🌐 Translated English</span>
                          <button 
                            className="copy-btn"
                            onClick={() => copyToClipboard(res.english, `${res.model_id}_eng`)}
                          >
                            {copiedKey === `${res.model_id}_eng` ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                        <div className="transcript-box english-text">
                          {res.english || '(Translation not available)'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}