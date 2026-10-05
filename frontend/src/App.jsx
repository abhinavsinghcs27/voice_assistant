import React, { useState, useRef, useEffect } from 'react';
import './App.css';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export default function App() {
  const [activeTab, setActiveTab] = useState('assistant'); // 'assistant' | 'analytics' | 'benchmark'

  // Common State
  const [models, setModels] = useState([]);
  const [ttsEngines, setTtsEngines] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [error, setError] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  // Settings & Persona State
  const [sttModel, setSttModel] = useState('indic-conformer-onnx');
  const [ttsEngine, setTtsEngine] = useState('edge-tts');
  const [selectedPersonaId, setSelectedPersonaId] = useState('vaani_inbound');
  const [customSystemPrompt, setCustomSystemPrompt] = useState('');
  const [customGreeting, setCustomGreeting] = useState('');
  const [vadThresholdSeconds, setVadThresholdSeconds] = useState(1.2); // 0.6s to 2.5s
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [enableBackchanneling, setEnableBackchanneling] = useState(true);
  const [showToolSimulator, setShowToolSimulator] = useState(false);

  // Conversational Fillers State
  const [fillers, setFillers] = useState([]);
  const [backchannelActive, setBackchannelActive] = useState(false);

  // Tool Simulator State
  const [simOrderInput, setSimOrderInput] = useState('ORD-1092');
  const [simOrderRes, setSimOrderRes] = useState(null);
  const [simFaultInput, setSimFaultInput] = useState('3142');
  const [simFaultRes, setSimFaultRes] = useState(null);
  const [simTicketInput, setSimTicketInput] = useState('Engine fuel rail sensor voltage erratic in field');
  const [simTicketRes, setSimTicketRes] = useState(null);

  // Voice Assistant Live Call State
  const [vaCallActive, setVaCallActive] = useState(false);
  const [vaPhase, setVaPhase] = useState('idle'); // 'idle' | 'greeting' | 'listening' | 'processing' | 'speaking'
  const [vaGreeting, setVaGreeting] = useState('');
  const [vaTimer, setVaTimer] = useState(0);
  const [vaSessionId, setVaSessionId] = useState(null);
  const [vaTurns, setVaTurns] = useState([]);
  const [bargeInOccurred, setBargeInOccurred] = useState(false);
  const [vaTelemetry, setVaTelemetry] = useState({
    sentiment: 'neutral',
    sentiment_score: 0.0,
    csat_estimate: 3,
    detected_intent: 'General Inquiry',
    human_escalation_flag: false,
    slots: {}
  });
  const [latestFeedbackReport, setLatestFeedbackReport] = useState(null);

  // Analytics & Call Log State
  const [analyticsData, setAnalyticsData] = useState({
    total_calls: 0,
    average_csat: 0.0,
    positive_sentiment_percent: 0.0,
    escalation_count: 0
  });
  const [callLogs, setCallLogs] = useState([]);
  const [selectedReportModal, setSelectedReportModal] = useState(null);
  const [expandedCallId, setExpandedCallId] = useState(null);

  // Benchmark State
  const [selectedModels, setSelectedModels] = useState([]);
  const [bmRecording, setBmRecording] = useState(false);
  const [bmTimer, setBmTimer] = useState(0);
  const [bmAudioBlob, setBmAudioBlob] = useState(null);
  const [bmAudioUrl, setBmAudioUrl] = useState(null);
  const [bmAudioName, setBmAudioName] = useState('');
  const [bmReferenceText, setBmReferenceText] = useState('');
  const [bmLoading, setBmLoading] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState(null);

  // Refs for Audio & VAD
  const vaStreamRef = useRef(null);
  const vaAudioCtxRef = useRef(null);
  const vaAnalyserRef = useRef(null);
  const vaMediaRecorderRef = useRef(null);
  const vaAudioChunksRef = useRef([]);
  const vaSilenceTimerRef = useRef(null);
  const vaSilenceStartRef = useRef(null);
  const vaPlaybackStartTimeRef = useRef(0);
  const vaTimerRef = useRef(null);
  const vaLiveAudioRef = useRef(null);
  const vaGreetAudioRef = useRef(null);
  const vaFillerAudioRef = useRef(null);
  const vaCallActiveRef = useRef(false);
  const vaPhaseRef = useRef('idle');
  const vaSessionIdRef = useRef(null);
  const abortControllerRef = useRef(null);
  const chatRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameIdRef = useRef(null);

  // Benchmark Refs
  const bmMediaRecorderRef = useRef(null);
  const bmAudioChunksRef = useRef([]);
  const bmTimerRef = useRef(null);
  const bmFileInputRef = useRef(null);

  // Synchronize state changes to refs
  const updateVaPhase = (phase) => {
    vaPhaseRef.current = phase;
    setVaPhase(phase);
  };

  useEffect(() => { vaCallActiveRef.current = vaCallActive; }, [vaCallActive]);
  useEffect(() => { vaSessionIdRef.current = vaSessionId; }, [vaSessionId]);

  // Initial Data Fetch
  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/models`).then(r => r.json()).catch(() => []),
      fetch(`${API_BASE}/api/tts/engines`).then(r => r.json()).catch(() => []),
      fetch(`${API_BASE}/api/personas`).then(r => r.json()).catch(() => []),
      fetch(`${API_BASE}/api/voice-assistant/fillers`).then(r => r.json()).catch(() => ({ fillers: [] }))
    ]).then(([modelsList, ttsList, personasList, fillersData]) => {
      setModels(modelsList);
      setSelectedModels(modelsList.map(m => m.id));
      setTtsEngines(ttsList);
      setPersonas(personasList);
      if (fillersData && fillersData.fillers) {
        setFillers(fillersData.fillers);
      }

      if (personasList.length > 0) {
        const def = personasList.find(p => p.id === 'vaani_inbound') || personasList[0];
        setSelectedPersonaId(def.id);
        setCustomSystemPrompt(def.system_prompt);
        setCustomGreeting(def.greeting);
      }
    }).catch(err => {
      console.error(err);
      setError("Failed to initialize system models & persona configurations.");
    });

    fetchAnalytics();
  }, []);

  const fetchAnalytics = () => {
    fetch(`${API_BASE}/api/voice-assistant/reports`)
      .then(r => r.json())
      .then(data => {
        if (data.analytics) setAnalyticsData(data.analytics);
        if (data.reports) setCallLogs(data.reports);
      })
      .catch(e => console.log("Analytics load:", e));
  };

  // Scroll chat on updates
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [vaTurns, vaGreeting, vaPhase]);

  // Copy helper
  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(typeof text === 'object' ? JSON.stringify(text, null, 2) : text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  // Persona Selector Change Handler
  const handlePersonaChange = (e) => {
    const pId = e.target.value;
    setSelectedPersonaId(pId);
    const matched = personas.find(p => p.id === pId);
    if (matched) {
      setCustomSystemPrompt(matched.system_prompt);
      setCustomGreeting(matched.greeting);
    }
  };

  // =========================================================================
  // 3. REACTIVE WAVEFORM VISUALIZER (Canvas 2D)
  // =========================================================================
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let phaseAngle = 0;

    const renderWave = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;
      ctx.clearRect(0, 0, width, height);

      const currentPhase = vaPhaseRef.current;
      const analyser = vaAnalyserRef.current;

      if (currentPhase === 'listening' && analyser) {
        // Real-time microphone frequency & time-domain wave
        const bufferLength = analyser.fftSize;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);

        ctx.lineWidth = 3;
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#06b6d4');
        gradient.addColorStop(0.5, '#10b981');
        gradient.addColorStop(1, '#3b82f6');
        ctx.strokeStyle = gradient;
        ctx.beginPath();

        const sliceWidth = (width * 1.0) / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = v * (height / 2);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        ctx.shadowBlur = 12;
        ctx.shadowColor = '#06b6d4';

      } else if (currentPhase === 'processing') {
        // Golden pulsating sine wave during server processing
        phaseAngle += 0.08;
        ctx.lineWidth = 3.5;
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#f59e0b');
        gradient.addColorStop(0.5, '#fbbf24');
        gradient.addColorStop(1, '#d97706');
        ctx.strokeStyle = gradient;
        ctx.shadowBlur = 16;
        ctx.shadowColor = '#f59e0b';
        ctx.beginPath();

        for (let x = 0; x < width; x++) {
          const frequency = 0.03;
          const amplitude = Math.sin(phaseAngle * 1.5) * 18 + 22;
          const y = centerY + Math.sin(x * frequency + phaseAngle) * amplitude;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

      } else if (currentPhase === 'speaking' || currentPhase === 'greeting') {
        // Active frequency spectrum of the assistant's speech
        phaseAngle += 0.12;
        ctx.lineWidth = 3;
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#a855f7');
        gradient.addColorStop(0.5, '#ec4899');
        gradient.addColorStop(1, '#6366f1');
        ctx.strokeStyle = gradient;
        ctx.shadowBlur = 14;
        ctx.shadowColor = '#ec4899';
        ctx.beginPath();

        for (let x = 0; x < width; x++) {
          const y = centerY + Math.sin(x * 0.04 + phaseAngle) * 20 * Math.sin((x / width) * Math.PI);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

      } else {
        // STANDBY
        phaseAngle += 0.02;
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.shadowBlur = 4;
        ctx.shadowColor = 'rgba(148, 163, 184, 0.3)';
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          const y = centerY + Math.sin(x * 0.02 + phaseAngle) * 2;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.shadowBlur = 0;
      animFrameIdRef.current = requestAnimationFrame(renderWave);
    };

    renderWave();
    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
    };
  }, []);

  // =========================================================================
  // 2. AUDIO & VAD SETUP
  // =========================================================================
  const setupAudioContextAndAnalyser = (stream) => {
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

  const triggerClientBargeIn = () => {
    if (!vaCallActiveRef.current) return;
    const currentP = vaPhaseRef.current;
    if (currentP === 'speaking' || currentP === 'greeting' || currentP === 'processing') {
      console.log("⚡ Zero-Latency Barge-In Triggered by User Speech");
      setBargeInOccurred(true);
      setTimeout(() => setBargeInOccurred(false), 2500);

      // 1. Immediately pause and reset playback & voice filler
      if (vaLiveAudioRef.current) {
        vaLiveAudioRef.current.pause();
        vaLiveAudioRef.current.currentTime = 0;
      }
      if (vaGreetAudioRef.current) {
        vaGreetAudioRef.current.pause();
        vaGreetAudioRef.current.currentTime = 0;
      }
      if (vaFillerAudioRef.current) {
        vaFillerAudioRef.current.pause();
        vaFillerAudioRef.current.currentTime = 0;
      }
      setBackchannelActive(false);

      // 2. Abort any in-flight fetch request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      // 3. Notify backend asynchronously
      if (vaSessionIdRef.current) {
        const fd = new FormData();
        fd.append('session_id', vaSessionIdRef.current);
        fetch(`${API_BASE}/api/voice-assistant/barge-in`, { method: 'POST', body: fd }).catch(e => console.log("Barge-in sync:", e));
      }

      // 4. Immediately switch back to listening
      startListening();
    }
  };

  const startSilenceAndBargeInMonitor = () => {
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

      const currentPhase = vaPhaseRef.current;

      // Barge-in check: If user speaks over assistant audio (debounce first 500ms of playback)
      const playbackAge = Date.now() - vaPlaybackStartTimeRef.current;
      if ((currentPhase === 'speaking' || currentPhase === 'greeting') && playbackAge > 500 && rms > 0.065) {
        triggerClientBargeIn();
        return;
      }

      // Turn submission check: If in listening phase and silence detected
      if (currentPhase === 'listening') {
        if (rms < 0.02) {
          if (vaSilenceStartRef.current === null) {
            vaSilenceStartRef.current = Date.now();
          } else if (Date.now() - vaSilenceStartRef.current >= (vadThresholdSeconds * 1000)) {
            stopAndSubmitTurn();
          }
        } else {
          vaSilenceStartRef.current = null;
        }
      }
    }, 150);
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

  // =========================================================================
  // 1. VOICE CALL FLOW (Hands-Free Loop)
  // =========================================================================
  const startCall = async () => {
    setError(null);
    setLatestFeedbackReport(null);
    setVaGreeting('');
    setVaTurns([]);
    setVaSessionId(null);
    vaSessionIdRef.current = null;

    try {
      if (!vaStreamRef.current) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 16000
          }
        });
        vaStreamRef.current = stream;
        setupAudioContextAndAnalyser(stream);
      }
      setVaCallActive(true);
      vaCallActiveRef.current = true;
      startGreeting();
    } catch (err) {
      console.error(err);
      setError("Microphone access denied or audio device not available.");
    }
  };

  const startGreeting = async () => {
    updateVaPhase('greeting');
    setVaTurns([]);
    try {
      const formData = new FormData();
      formData.append('persona_id', selectedPersonaId);
      formData.append('tts_engine', ttsEngine);
      if (customGreeting.trim()) formData.append('custom_greeting', customGreeting.trim());

      const res = await fetch(`${API_BASE}/api/voice-assistant/greet`, { method: 'POST', body: formData });
      if (!res.ok) {
        const ed = await res.json();
        throw new Error(ed.detail || 'Greeting failed.');
      }
      const data = await res.json();
      setVaGreeting(data.text);
      vaPlaybackStartTimeRef.current = Date.now();
      startSilenceAndBargeInMonitor();

      const el = vaGreetAudioRef.current;
      if (el && data.audio_url) {
        el.src = data.audio_url;
        el.play().catch((e) => {
          console.log("Autoplay check:", e);
          startListening();
        });
      } else {
        startListening();
      }
    } catch (err) {
      setError(err.message);
      setVaCallActive(false);
      vaCallActiveRef.current = false;
      updateVaPhase('idle');
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
        if (vaCallActiveRef.current && blob.size > 100) {
          submitTurn(blob);
        } else if (vaCallActiveRef.current) {
          startListening();
        }
      };

      recorder.start(200); // 200ms slice chunks
      updateVaPhase('listening');
      setVaTimer(0);
      if (vaTimerRef.current) clearInterval(vaTimerRef.current);
      vaTimerRef.current = setInterval(() => setVaTimer(prev => prev + 1), 1000);
      startSilenceAndBargeInMonitor();
    } catch (err) {
      console.error(err);
      setError("Could not initialize microphone recorder.");
    }
  };

  const stopAndSubmitTurn = () => {
    stopSilenceMonitor();
    if (vaTimerRef.current) clearInterval(vaTimerRef.current);
    const recorder = vaMediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      updateVaPhase('processing');
      recorder.stop();
    }
  };

  const submitTurn = async (blob) => {
    if (!vaCallActiveRef.current) return;
    updateVaPhase('processing');
    console.log(`[Voice Assistant] Submitting voice turn: ${blob.size} bytes`);

    // ⚡ Instant Backchanneling Voice Filler Playback
    if (enableBackchanneling && fillers.length > 0) {
      try {
        const randomFiller = fillers[Math.floor(Math.random() * fillers.length)];
        const fillerEl = vaFillerAudioRef.current;
        if (fillerEl && randomFiller.audio_url) {
          fillerEl.src = randomFiller.audio_url;
          fillerEl.currentTime = 0;
          fillerEl.play().catch(e => console.log("Filler play error:", e));
          setBackchannelActive(true);
        }
      } catch (fe) {
        console.log("Filler trigger error:", fe);
      }
    }

    const formData = new FormData();
    formData.append('audio', blob, `turn_${Date.now()}.webm`);
    formData.append('stt_model', sttModel);
    formData.append('persona_id', selectedPersonaId);
    formData.append('tts_engine', ttsEngine);
    if (customSystemPrompt.trim()) formData.append('custom_system_prompt', customSystemPrompt.trim());
    if (vaSessionIdRef.current) formData.append('session_id', vaSessionIdRef.current);

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(`${API_BASE}/api/voice-assistant/interact`, {
        method: 'POST',
        body: formData,
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Voice turn processing failed.');
      }

      const data = await response.json();

      // Stop voice filler as soon as the real response arrives
      if (vaFillerAudioRef.current) {
        vaFillerAudioRef.current.pause();
        vaFillerAudioRef.current.currentTime = 0;
      }
      setBackchannelActive(false);

      vaSessionIdRef.current = data.session_id;
      setVaSessionId(data.session_id);
      if (data.telemetry) setVaTelemetry(data.telemetry);

      const newTurn = {
        id: data.id,
        turn_index: data.turn_index,
        user_transcript: data.user_transcript,
        llm_response: data.llm_response,
        audio_url: data.audio_url,
        user_recording_url: data.user_recording_url,
        assistant_recording_url: data.assistant_recording_url,
        tool_calls: data.tool_calls || [],
        latency: data.latency,
        tts_engine_used: data.tts_engine_used,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };

      setVaTurns(prev => [...prev, newTurn]);
      updateVaPhase('speaking');
      vaPlaybackStartTimeRef.current = Date.now();

      // Play audio response with barge-in active
      const el = vaLiveAudioRef.current;
      if (el && data.audio_url) {
        el.src = data.audio_url;
        el.play().catch(e => console.log("Playback interrupted or blocked:", e));
      }
      startSilenceAndBargeInMonitor();
    } catch (err) {
      if (vaFillerAudioRef.current) {
        vaFillerAudioRef.current.pause();
        vaFillerAudioRef.current.currentTime = 0;
      }
      setBackchannelActive(false);

      if (err.name === 'AbortError') {
        console.log("Turn request aborted by barge-in.");
      } else {
        setError(err.message);
        if (vaCallActiveRef.current) startListening();
      }
    }
  };

  const handleLiveAudioEnded = () => {
    if (vaCallActiveRef.current && vaPhaseRef.current === 'speaking') {
      setTimeout(() => startListening(), 300);
    }
  };

  const handleGreetAudioEnded = () => {
    if (vaCallActiveRef.current && vaPhaseRef.current === 'greeting') {
      startListening();
    }
  };

  const endCall = async () => {
    if (vaFillerAudioRef.current) {
      vaFillerAudioRef.current.pause();
      vaFillerAudioRef.current.currentTime = 0;
    }
    setBackchannelActive(false);
    stopSilenceMonitor();
    if (vaTimerRef.current) clearInterval(vaTimerRef.current);
    const recorder = vaMediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();

    vaCallActiveRef.current = false;
    setVaCallActive(false);
    updateVaPhase('idle');
    stopMicTracks();

    await finalizeSession();
  };

  // Tool Simulation Handlers
  const handleSimOrder = async () => {
    if (!simOrderInput.trim()) return;
    const fd = new FormData();
    fd.append('order_id', simOrderInput.trim());
    try {
      const res = await fetch('/api/tools/lookup_order', { method: 'POST', body: fd });
      const data = await res.json();
      setSimOrderRes(data);
    } catch (e) {
      setSimOrderRes({ error: e.message });
    }
  };

  const handleSimFault = async () => {
    if (!simFaultInput.trim()) return;
    const fd = new FormData();
    fd.append('fault_code', simFaultInput.trim());
    try {
      const res = await fetch('/api/tools/lookup_cnh_dtc_fault', { method: 'POST', body: fd });
      const data = await res.json();
      setSimFaultRes(data);
    } catch (e) {
      setSimFaultRes({ error: e.message });
    }
  };

  const handleSimTicket = async () => {
    if (!simTicketInput.trim()) return;
    const fd = new FormData();
    fd.append('issue_summary', simTicketInput.trim());
    fd.append('priority', 'High');
    try {
      const res = await fetch('/api/tools/create_support_ticket', { method: 'POST', body: fd });
      const data = await res.json();
      setSimTicketRes(data);
    } catch (e) {
      setSimTicketRes({ error: e.message });
    }
  };

  const finalizeSession = async () => {
    if (!vaSessionIdRef.current) return;
    try {
      const formData = new FormData();
      formData.append('session_id', vaSessionIdRef.current);
      const res = await fetch(`${API_BASE}/api/voice-assistant/finalize`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Finalize report compilation failed.');
      }
      const data = await res.json();
      setLatestFeedbackReport(data.structured_feedback);
      fetchAnalytics();
    } catch (err) {
      setError(err.message);
    }
  };

  // =========================================================================
  // 7. GROUND-TRUTH ACCURACY BENCHMARK & LEVENSHTEIN ENGINE (WER / CER)
  // =========================================================================
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
        setBmAudioName(`benchmark_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.webm`);
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
      setError("No audio recording or file selected for benchmarking.");
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
    if (bmReferenceText.trim()) formData.append('reference_text', bmReferenceText.trim());

    try {
      const response = await fetch(`${API_BASE}/api/benchmark`, {
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

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="header-section">
        <div className="header-badge-row">
          <span className="header-badge">✨ Multi-Domain Voice Intelligence Studio</span>
          <span className="header-badge-sub">Sub-Second Conversational Pipeline</span>
        </div>
        <h1 className="app-title">Vaani AI Studio</h1>
        <p className="app-subtitle">
          Next-generation bilingual Hindi & Hinglish conversational voice assistant with zero-latency barge-in, multi-engine TTS, live slot tracking, and ground-truth WER/CER benchmarking.
        </p>

        {/* Navigation Tabs */}
        <div className="tab-bar">
          <button
            className={`tab-btn ${activeTab === 'assistant' ? 'active' : ''}`}
            onClick={() => setActiveTab('assistant')}
          >
            🎙️ Voice Assistant Studio
          </button>
          <button
            className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => { setActiveTab('analytics'); fetchAnalytics(); }}
          >
            📊 Post-Call Analytics & Logs
          </button>
          <button
            className={`tab-btn ${activeTab === 'benchmark' ? 'active' : ''}`}
            onClick={() => setActiveTab('benchmark')}
          >
            📈 STT Benchmark & WER/CER
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span>⚠️</span> {error}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 1: VOICE ASSISTANT STUDIO & LIVE CALL */}
      {/* ==================================================================== */}
      {activeTab === 'assistant' && (
        <div className="tab-content">
          {/* Top Session Bar */}
          <div className="session-bar">
            <div className="session-info">
              <span>💬 Session:</span>
              <span className="session-badge">{vaSessionId || 'Ready'}</span>
              <span>• Turns: <strong>{vaTurns.length}</strong></span>
              {vaCallActive && (
                <span className={`call-live-tag ${vaPhase}`}>
                  🟢 Call Active ({vaPhase.toUpperCase()})
                </span>
              )}
              {backchannelActive && (
                <span className="backchannel-badge">⚡ Voice Backchannel Active ("Ji ek second...")</span>
              )}
              {bargeInOccurred && (
                <span className="barge-in-badge">⚡ Interrupted by Barge-In</span>
              )}
            </div>
            {vaCallActive && (
              <button className="btn-reset-session end-call-btn" onClick={endCall}>
                🔴 End Call & Finalize
              </button>
            )}
          </div>

          {/* Persona Studio & Pipeline Configuration Card */}
          <div className="card persona-studio-card">
            <div className="section-header">
              <div className="section-title">
                <span>🎭</span> Multi-Domain Persona Studio & Pipeline Configuration
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  className="btn-toggle-editor"
                  onClick={() => setShowToolSimulator(!showToolSimulator)}
                >
                  {showToolSimulator ? '▲ Hide Tool Simulator' : '🛠️ External CRM & Tool Playground'}
                </button>
                <button
                  className="btn-toggle-editor"
                  onClick={() => setShowPromptEditor(!showPromptEditor)}
                >
                  {showPromptEditor ? '▲ Hide Directives' : '✏️ Tune Runtime Directives'}
                </button>
              </div>
            </div>

            <div className="assistant-settings-grid">
              {/* Persona Selector */}
              <div className="setting-box">
                <label className="setting-label">Active Persona Preset</label>
                <select
                  className="setting-select"
                  value={selectedPersonaId}
                  onChange={handlePersonaChange}
                  disabled={vaCallActive}
                >
                  {personas.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* STT Model Selector */}
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
                      {m.name} {m.id === 'indic-conformer-onnx' ? '⚡ (<200ms)' : m.id === 'groq-whisper-large-v3-turbo' ? '☁️ (Cloud GPU)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* TTS Multi-Engine Selector */}
              <div className="setting-box">
                <label className="setting-label">TTS Synthesis Engine</label>
                <select
                  className="setting-select"
                  value={ttsEngine}
                  onChange={(e) => setTtsEngine(e.target.value)}
                  disabled={vaCallActive}
                >
                  {ttsEngines.map(eng => (
                    <option key={eng.id} value={eng.id} disabled={!eng.available}>
                      {eng.name} {eng.is_offline ? '🛡️ (100% Offline)' : '⚡ (Neural Stream)'}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tunable VAD Silence Threshold & Backchanneling Switch */}
              <div className="setting-box">
                <div className="setting-label-row">
                  <label className="setting-label">VAD Silence Threshold</label>
                  <span className="vad-value-badge">{vadThresholdSeconds}s</span>
                </div>
                <input
                  type="range"
                  min="0.6"
                  max="2.5"
                  step="0.1"
                  className="vad-slider"
                  value={vadThresholdSeconds}
                  onChange={(e) => setVadThresholdSeconds(parseFloat(e.target.value))}
                  disabled={vaCallActive}
                />
                <div className="vad-hints">
                  <span>0.6s (Fast)</span>
                  <span>1.2s (Standard)</span>
                  <span>2.5s (Noisy)</span>
                </div>

                <div style={{ marginTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.5rem' }}>
                  <label className="filler-toggle-label">
                    <input
                      type="checkbox"
                      checked={enableBackchanneling}
                      onChange={(e) => setEnableBackchanneling(e.target.checked)}
                      disabled={vaCallActive}
                    />
                    <span>⚡ Instant Voice Backchanneling (Latency Masking)</span>
                  </label>
                </div>
              </div>
            </div>

            {/* External Tool Simulator Playground */}
            {showToolSimulator && (
              <div className="tool-simulator-panel">
                <div className="section-header" style={{ marginBottom: '0.5rem' }}>
                  <div className="section-title" style={{ fontSize: '0.95rem' }}>
                    <span>🛠️</span> Simulated External Tool Calling & Dynamic CRM Actions
                  </div>
                  <span className="section-hint">Test backchannel-enabled live tool execution</span>
                </div>
                <div className="tool-sim-grid">
                  {/* Tool 1: Order Lookup */}
                  <div className="sim-box">
                    <div className="sim-box-title">📦 lookup_order(order_id)</div>
                    <div className="sim-input-row">
                      <input
                        type="text"
                        className="sim-input"
                        value={simOrderInput}
                        onChange={(e) => setSimOrderInput(e.target.value)}
                        placeholder="e.g. ORD-1092 or ORD-4821"
                      />
                      <button className="sim-btn" onClick={handleSimOrder}>Lookup</button>
                    </div>
                    {simOrderRes && (
                      <div className="sim-result-box">
                        {JSON.stringify(simOrderRes.data || simOrderRes, null, 2)}
                      </div>
                    )}
                  </div>

                  {/* Tool 2: CNH Telematics Fault Code */}
                  <div className="sim-box">
                    <div className="sim-box-title">🚜 lookup_cnh_dtc_fault(fault_code)</div>
                    <div className="sim-input-row">
                      <input
                        type="text"
                        className="sim-input"
                        value={simFaultInput}
                        onChange={(e) => setSimFaultInput(e.target.value)}
                        placeholder="e.g. 3142, 1124, 4201, 5200"
                      />
                      <button className="sim-btn" onClick={handleSimFault}>Diagnose</button>
                    </div>
                    {simFaultRes && (
                      <div className="sim-result-box">
                        {JSON.stringify(simFaultRes.data || simFaultRes, null, 2)}
                      </div>
                    )}
                  </div>

                  {/* Tool 3: Create Support Ticket */}
                  <div className="sim-box">
                    <div className="sim-box-title">🎫 create_support_ticket(summary)</div>
                    <div className="sim-input-row">
                      <input
                        type="text"
                        className="sim-input"
                        value={simTicketInput}
                        onChange={(e) => setSimTicketInput(e.target.value)}
                        placeholder="Issue summary for escalation..."
                      />
                      <button className="sim-btn" onClick={handleSimTicket}>Escalate</button>
                    </div>
                    {simTicketRes && (
                      <div className="sim-result-box">
                        {JSON.stringify(simTicketRes.data || simTicketRes, null, 2)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Collapsible Directive Editor */}
            {showPromptEditor && (
              <div className="prompt-editor-panel">
                <div className="editor-row">
                  <div className="editor-col">
                    <label className="editor-label">Custom System Prompt / Directives</label>
                    <textarea
                      className="prompt-textarea"
                      rows="4"
                      value={customSystemPrompt}
                      onChange={(e) => setCustomSystemPrompt(e.target.value)}
                      placeholder="Customize the LLM persona guidelines..."
                      disabled={vaCallActive}
                    />
                  </div>
                  <div className="editor-col">
                    <label className="editor-label">Persona Initial Greeting Text</label>
                    <textarea
                      className="prompt-textarea"
                      rows="4"
                      value={customGreeting}
                      onChange={(e) => setCustomGreeting(e.target.value)}
                      placeholder="Initial greeting spoken when starting call..."
                      disabled={vaCallActive}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Interactive Audio Visualizer & Call Stage */}
          <div className="card visualizer-card">
            <div className="section-header">
              <div className="section-title">
                <span>🎙️</span> {vaCallActive ? 'Live Call & Audio Visualizer' : 'Voice Assistant Call Console'}
              </div>
              <span className="section-hint">
                {vaCallActive
                  ? '🔄 Hands-Free VAD + Instant Barge-In + Audio Backchanneling Enabled'
                  : 'Click Start Call to initiate the hands-free voice pipeline'}
              </span>
            </div>

            {/* 2D Canvas Waveform */}
            <div className="visualizer-wrapper">
              <canvas
                ref={canvasRef}
                id="va-waveform-canvas"
                width="800"
                height="120"
                className={`waveform-canvas ${vaPhase}`}
              />
              <div className="visualizer-status-pill">
                {vaPhase === 'idle' && '⚪ Standby (Microphone Idle)'}
                {vaPhase === 'greeting' && '👋 Assistant Greeting'}
                {vaPhase === 'listening' && `🎙️ Listening... (VAD commit ${vadThresholdSeconds}s)`}
                {vaPhase === 'processing' && (
                  backchannelActive
                    ? '⚡ Masking Latency: Playing Instant Voice Filler & Reasoning...'
                    : '⚡ Reasoning, Executing Tools & Synthesizing Response...'
                )}
                {vaPhase === 'speaking' && '🔊 Assistant Speaking (Speak anytime to barge-in)'}
              </div>
            </div>

            {/* Start Call Button & Phase Indicators */}
            {!vaCallActive ? (
              <div className="call-action-box">
                <button className="btn btn-primary btn-start-call" onClick={startCall}>
                  <span>▶️</span> Start Voice Call
                </button>
              </div>
            ) : (
              <div className="active-call-controls">
                <div className="active-timer">
                  <span>⏱️ Call Duration:</span> <strong>{formatTime(vaTimer)}</strong>
                </div>
                <button className="btn btn-discard" onClick={endCall}>
                  🔴 End Call & Finalize
                </button>
              </div>
            )}

            {/* Hidden Audio Elements for Playback */}
            <audio ref={vaGreetAudioRef} onEnded={handleGreetAudioEnded} style={{ display: 'none' }} />
            <audio ref={vaLiveAudioRef} onEnded={handleLiveAudioEnded} style={{ display: 'none' }} />
            <audio ref={vaFillerAudioRef} style={{ display: 'none' }} />
          </div>

          {/* Memory Slots & Real-Time Telemetry Dashboard */}
          {(vaTurns.length > 0 || (vaTelemetry.slots && Object.keys(vaTelemetry.slots).length > 0)) && (
            <div className="telemetry-card">
              <div className="section-header">
                <div className="section-title">
                  <span>🧠</span> Active Memory Slots & Real-Time Telemetry
                </div>
                <span className="section-hint">Persisted State Across Turns & Tool Executions</span>
              </div>

              {/* Telemetry Metrics Row */}
              <div className="telemetry-grid">
                <div className="telemetry-item">
                  <span className="telemetry-label">Customer Sentiment</span>
                  <div className={`sentiment-badge ${vaTelemetry.sentiment}`}>
                    {vaTelemetry.sentiment === 'positive' && '🟢 Positive'}
                    {vaTelemetry.sentiment === 'neutral' && '🟡 Neutral'}
                    {vaTelemetry.sentiment === 'negative' && '🔴 Negative'}
                    {vaTelemetry.sentiment === 'frustrated' && '🔥 Frustrated'}
                  </div>
                </div>

                <div className="telemetry-item">
                  <span className="telemetry-label">Estimated CSAT Rating</span>
                  <div className="csat-stars">
                    {'★'.repeat(vaTelemetry.csat_estimate || 3)}{'☆'.repeat(5 - (vaTelemetry.csat_estimate || 3))}
                    <span className="csat-number">({vaTelemetry.csat_estimate || 3}/5)</span>
                  </div>
                </div>

                <div className="telemetry-item">
                  <span className="telemetry-label">Detected Intent</span>
                  <div className="intent-tag">
                    🏷️ {vaTelemetry.detected_intent || 'General Inquiry'}
                  </div>
                </div>

                <div className="telemetry-item">
                  <span className="telemetry-label">Escalation Status</span>
                  <div className={`escalation-pill ${vaTelemetry.human_escalation_flag ? 'escalated' : 'normal'}`}>
                    {vaTelemetry.human_escalation_flag ? '⚠️ Escalation Flagged' : '✅ Handled by Voice AI'}
                  </div>
                </div>
              </div>

              {/* Entity Memory Slots Grid */}
              {vaTelemetry.slots && Object.keys(vaTelemetry.slots).length > 0 && (
                <div className="slots-container">
                  <span className="slots-header-title">Extracted Domain Memory Slots:</span>
                  <div className="slots-tags-list">
                    {Object.entries(vaTelemetry.slots).map(([slotKey, slotVal]) => (
                      <div className="slot-chip" key={slotKey}>
                        <span className="slot-key">{slotKey}:</span>
                        <span className="slot-val">{String(slotVal)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Conversation Chat Transcript */}
          {(vaTurns.length > 0 || vaGreeting) && (
            <div className="card chat-card">
              <div className="section-header">
                <div className="section-title">
                  <span>💬</span> Conversational Transcript & Live Audio Archive
                </div>
                <span className="section-hint">Multi-turn history with latency breakdown, tool calls, and turn recordings</span>
              </div>

              <div className="chat-container" ref={chatRef}>
                {vaGreeting && (
                  <div className="chat-msg assistant">
                    <div className="chat-bubble">
                      <div className="chat-meta">
                        <span className="chat-name">Assistant ({selectedPersonaId})</span>
                      </div>
                      <div className="chat-text">{vaGreeting}</div>
                    </div>
                  </div>
                )}

                {vaTurns.map((turn, idx) => (
                  <div className="chat-turn" key={turn.id || idx}>
                    {/* User message */}
                    <div className="chat-msg user">
                      <div className="chat-bubble">
                        <div className="chat-meta">
                          <span className="chat-name">User (Turn #{turn.turn_index || idx + 1})</span>
                          <span className="chat-time">{turn.timestamp}</span>
                        </div>
                        <div className="chat-text devanagari-text">
                          {turn.user_transcript.devanagari || turn.user_transcript.raw}
                        </div>
                        {turn.user_transcript.romanised && (
                          <div className="chat-sub">🔤 {turn.user_transcript.romanised}</div>
                        )}
                        {turn.user_transcript.english && (
                          <div className="chat-sub">🌐 {turn.user_transcript.english}</div>
                        )}
                        {turn.latency && (
                          <div className="chat-latency">
                            ⚡ {turn.latency.total_seconds}s total (STT {turn.latency.stt_seconds}s · LLM {turn.latency.llm_seconds}s · TTS {turn.latency.tts_seconds}s [{turn.tts_engine_used || 'edge-tts'}])
                          </div>
                        )}
                        {turn.user_recording_url && (
                          <div className="chat-audio" style={{ marginTop: '0.4rem' }}>
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>🎙️ User Audio Turn:</span>
                            <audio controls src={turn.user_recording_url} className="mini-audio-player" style={{ width: '100%', marginTop: '2px' }} />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Assistant message */}
                    <div className="chat-msg assistant">
                      <div className="chat-bubble">
                        <div className="chat-meta">
                          <span className="chat-name">
                            Assistant <span className="chat-model">({turn.llm_response.model_used})</span>
                          </span>
                          <span className="chat-time">{turn.timestamp}</span>
                        </div>
                        <div className="chat-text">"{turn.llm_response.text}"</div>

                        {/* Executed External Tools Rendering */}
                        {turn.tool_calls && turn.tool_calls.length > 0 && (
                          <div className="tool-calls-container">
                            {turn.tool_calls.map((tCall, tIdx) => {
                              const tName = tCall.tool;
                              const tData = tCall.result?.data || {};
                              
                              if (tName === 'lookup_order') {
                                return (
                                  <div className="tool-card order-lookup" key={tIdx}>
                                    <div className="tool-card-header">
                                      <span>📦 Live Carrier Dispatch Lookup ({tCall.arguments?.order_id})</span>
                                      <span className="tool-badge-pill">{tData.status || 'Active'}</span>
                                    </div>
                                    <div className="tool-grid-details">
                                      <div className="tool-detail-item">
                                        <span className="tool-detail-label">Carrier & Tracking</span>
                                        <span className="tool-detail-val">{tData.carrier} ({tData.tracking_number})</span>
                                      </div>
                                      <div className="tool-detail-item">
                                        <span className="tool-detail-label">Estimated Delivery</span>
                                        <span className="tool-detail-val">{tData.estimated_delivery}</span>
                                      </div>
                                      <div className="tool-detail-item">
                                        <span className="tool-detail-label">Current Hub</span>
                                        <span className="tool-detail-val">{tData.current_location}</span>
                                      </div>
                                      <div className="tool-detail-item">
                                        <span className="tool-detail-label">Product Item</span>
                                        <span className="tool-detail-val">{tData.product}</span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              } else if (tName === 'lookup_cnh_dtc_fault') {
                                return (
                                  <div className="tool-card cnh-dtc" key={tIdx}>
                                    <div className="tool-card-header">
                                      <span>🚜 CNH Telematics Fault Code #{tData.fault_code} ({tData.spn_fmi})</span>
                                      <span className="tool-badge-pill" style={{ color: '#f97316' }}>{tData.severity?.split('-')[0] || 'Warning'}</span>
                                    </div>
                                    <div className="tool-grid-details">
                                      <div className="tool-detail-item">
                                        <span className="tool-detail-label">Subsystem</span>
                                        <span className="tool-detail-val">{tData.subsystem}</span>
                                      </div>
                                      <div className="tool-detail-item">
                                        <span className="tool-detail-label">Component</span>
                                        <span className="tool-detail-val">{tData.component}</span>
                                      </div>
                                    </div>
                                    <div className="tool-action-text">
                                      <strong>Field Action:</strong> {tData.recommended_actions}
                                    </div>
                                  </div>
                                );
                              } else if (tName === 'create_support_ticket') {
                                return (
                                  <div className="tool-card support-ticket" key={tIdx}>
                                    <div className="tool-card-header">
                                      <span>🎫 Live Support Ticket Escalation</span>
                                      <span className="tool-badge-pill">{tCall.result?.ticket_id}</span>
                                    </div>
                                    <div className="tool-grid-details">
                                      <div className="tool-detail-item">
                                        <span className="tool-detail-label">Assigned Queue</span>
                                        <span className="tool-detail-val">{tData.assigned_team}</span>
                                      </div>
                                      <div className="tool-detail-item">
                                        <span className="tool-detail-label">SLA Target</span>
                                        <span className="tool-detail-val">{tData.sla_target}</span>
                                      </div>
                                    </div>
                                    <div className="tool-action-text">
                                      🔔 {tData.sms_notification}
                                    </div>
                                  </div>
                                );
                              }
                              return null;
                            })}
                          </div>
                        )}

                        {turn.audio_url && (
                          <div className="chat-audio" style={{ marginTop: '0.5rem' }}>
                            <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>🔊 Assistant Voice Audio:</span>
                            <audio controls src={turn.audio_url} className="mini-audio-player" style={{ width: '100%', marginTop: '2px' }} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Post-Call Report Preview if finalized */}
          {latestFeedbackReport && (
            <div className="report-card">
              <div className="section-header">
                <div className="section-title">
                  <span>📋</span> Post-Call Analysis Summary
                </div>
                <span className="report-saved-hint">
                  💾 Saved to: backend/post-call-analysis/{latestFeedbackReport.record_id || ''}_feedback.json
                </span>
              </div>

              <div className="report-grid">
                <div className="report-item">
                  <span className="report-label">Aggregate Sentiment</span>
                  <div className={`sentiment-badge ${latestFeedbackReport.aggregate_sentiment || 'neutral'}`}>
                    {latestFeedbackReport.aggregate_sentiment}
                  </div>
                </div>
                <div className="report-item">
                  <span className="report-label">Overall CSAT</span>
                  <div className="csat-stars">
                    {'★'.repeat(latestFeedbackReport.overall_satisfaction || 3)}{'☆'.repeat(5 - (latestFeedbackReport.overall_satisfaction || 3))}
                    <span className="csat-number">({latestFeedbackReport.overall_satisfaction || 3}/5)</span>
                  </div>
                </div>
                <div className="report-item">
                  <span className="report-label">Resolution Status</span>
                  <div className="intent-tag">
                    {latestFeedbackReport.resolution_status || 'resolved'}
                  </div>
                </div>
              </div>

              <div className="report-summary">
                <p><strong>Summary (Hindi/Hinglish):</strong> {latestFeedbackReport.summary_hindi || '—'}</p>
                <p><strong>Summary (English):</strong> {latestFeedbackReport.summary_english || '—'}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: POST-CALL ANALYTICS & HISTORICAL LOGS */}
      {/* ==================================================================== */}
      {activeTab === 'analytics' && (
        <div className="tab-content">
          {/* Executive Analytics KPI Cards */}
          <div className="analytics-kpi-grid">
            <div className="kpi-card">
              <span className="kpi-icon">📞</span>
              <div className="kpi-info">
                <span className="kpi-title">Total Completed Calls</span>
                <span className="kpi-value">{analyticsData.total_calls}</span>
              </div>
            </div>

            <div className="kpi-card">
              <span className="kpi-icon">⭐</span>
              <div className="kpi-info">
                <span className="kpi-title">Average CSAT Score</span>
                <span className="kpi-value">{analyticsData.average_csat} / 5.0</span>
              </div>
            </div>

            <div className="kpi-card">
              <span className="kpi-icon">💚</span>
              <div className="kpi-info">
                <span className="kpi-title">Positive Sentiment %</span>
                <span className="kpi-value">{analyticsData.positive_sentiment_percent}%</span>
              </div>
            </div>

            <div className="kpi-card">
              <span className="kpi-icon">🚨</span>
              <div className="kpi-info">
                <span className="kpi-title">Escalations Flagged</span>
                <span className="kpi-value">{analyticsData.escalation_count}</span>
              </div>
            </div>
          </div>

          {/* Historical Call Log Explorer Table */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <span>📑</span> Post-Call Structured Feedback Log Explorer
              </div>
              <button className="btn btn-secondary btn-sm" onClick={fetchAnalytics}>
                🔄 Refresh Logs
              </button>
            </div>

            {callLogs.length === 0 ? (
              <div className="empty-state-box">
                <p>No post-call records yet. Start and complete a call in the Voice Assistant tab to see generated reports here.</p>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="logs-table">
                  <thead>
                    <tr>
                      <th>Record ID / Time</th>
                      <th>Persona</th>
                      <th>Sentiment</th>
                      <th>CSAT</th>
                      <th>Resolution</th>
                      <th>Extracted Slots</th>
                      <th>Session Audio Archive</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callLogs.map((log) => {
                      const isExpanded = expandedCallId === (log.record_id || log.session_id);
                      const recs = log.recordings || [];
                      return (
                        <React.Fragment key={log.record_id || log.session_id}>
                          <tr>
                            <td>
                              <div className="log-id">{log.record_id || log.session_id}</div>
                              <div className="log-timestamp">{log.created_timestamp || 'Recent'}</div>
                            </td>
                            <td>
                              <span className="persona-tag">{log.persona_name || log.persona_id || 'Vaani Inbound'}</span>
                            </td>
                            <td>
                              <span className={`sentiment-badge ${log.aggregate_sentiment || 'neutral'}`}>
                                {log.aggregate_sentiment || 'neutral'}
                              </span>
                            </td>
                            <td>
                              <span className="csat-stars-small">
                                {'★'.repeat(log.overall_satisfaction || 3)}
                              </span>
                              <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginLeft: '4px' }}>
                                ({log.overall_satisfaction || 3}/5)
                              </span>
                            </td>
                            <td>
                              <span className={`status-pill ${log.resolution_status || 'resolved'}`}>
                                {log.resolution_status || 'resolved'}
                              </span>
                            </td>
                            <td>
                              <div className="slots-compact">
                                {log.extracted_slots && Object.keys(log.extracted_slots).length > 0 ? (
                                  Object.entries(log.extracted_slots).filter(([_, v]) => v).map(([k, v]) => (
                                    <span key={k} className="slot-mini-badge">{k}: {v}</span>
                                  ))
                                ) : (
                                  <span style={{ color: '#64748b' }}>None</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <button
                                className="btn-play-audio"
                                onClick={() => setExpandedCallId(isExpanded ? null : (log.record_id || log.session_id))}
                              >
                                {isExpanded ? '▲ Hide Audio' : `▶️ Listen (${recs.length} clips)`}
                              </button>
                            </td>
                            <td>
                              <button
                                className="btn-inspect"
                                onClick={() => setSelectedReportModal(log)}
                              >
                                🔍 View JSON
                              </button>
                            </td>
                          </tr>

                          {/* Expandable Audio Playback Row */}
                          {isExpanded && (
                            <tr>
                              <td colSpan="8" style={{ padding: 0 }}>
                                <div className="recordings-list-drawer">
                                  <div className="drawer-title">
                                    🎙️ Session Audio Recording Archive ({log.session_id || log.record_id}) - {recs.length} Turns Recorded
                                  </div>
                                  {recs.length === 0 ? (
                                    <div style={{ color: '#64748b', fontSize: '0.8rem' }}>No audio files archived for this session yet.</div>
                                  ) : (
                                    recs.map((r, rIdx) => (
                                      <div className="drawer-turn-row" key={rIdx}>
                                        <span className={`drawer-turn-role ${r.type}`}>
                                          {r.type === 'user' ? '👤 User Turn' : '🤖 Assistant'}
                                        </span>
                                        <span className="drawer-turn-text">{r.filename}</span>
                                        <audio controls src={r.url} className="mini-audio-player" />
                                      </div>
                                    ))
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* JSON Inspector Modal */}
          {selectedReportModal && (
            <div className="modal-overlay" onClick={() => setSelectedReportModal(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>📄 Post-Call Analysis JSON Record ({selectedReportModal.record_id})</h3>
                  <button className="modal-close-btn" onClick={() => setSelectedReportModal(null)}>✕</button>
                </div>
                <div className="modal-body">
                  {selectedReportModal.recordings && selectedReportModal.recordings.length > 0 && (
                    <div style={{ marginBottom: '1.25rem', padding: '0.75rem', background: 'rgba(15,23,42,0.8)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <h4 style={{ fontSize: '0.85rem', color: '#93c5fd', marginBottom: '0.5rem' }}>🎙️ Turn Audio Recordings for this Call:</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {selectedReportModal.recordings.map((rec, rIdx) => (
                          <div key={rIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', fontSize: '0.8rem' }}>
                            <span style={{ color: rec.type === 'user' ? '#60a5fa' : '#c084fc', fontWeight: 600 }}>
                              {rec.type === 'user' ? 'User Speech' : 'Assistant Audio'} ({rec.filename})
                            </span>
                            <audio controls src={rec.url} className="mini-audio-player" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <pre className="json-viewer">
                    {JSON.stringify(selectedReportModal, null, 2)}
                  </pre>
                </div>
                <div className="modal-footer">
                  <button
                    className="btn btn-secondary"
                    onClick={() => copyToClipboard(selectedReportModal, 'modal_json')}
                  >
                    {copiedKey === 'modal_json' ? '✓ Copied JSON' : '📋 Copy JSON'}
                  </button>
                  <button className="btn btn-primary" onClick={() => setSelectedReportModal(null)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: STT BENCHMARK & WER / CER EVALUATION */}
      {/* ==================================================================== */}
      {activeTab === 'benchmark' && (
        <div className="tab-content">
          {/* Model Selection Card */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <span>⚙️</span> Select Models to Benchmark
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

          {/* Ground-Truth Reference Text & Audio Capture Card */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <span>🎙️</span> Benchmark Audio & Ground-Truth Reference Text
              </div>
              <span className="section-hint">Calculate exact WER % & CER % via Levenshtein Metric Engine</span>
            </div>

            {/* Reference Ground-Truth Textarea */}
            <div className="reference-input-box">
              <label className="reference-label">
                <span>🎯 Ground-Truth Reference Transcript (Optional for WER / CER scoring):</span>
              </label>
              <textarea
                className="reference-textarea"
                rows="2"
                placeholder="Enter exact expected Hindi or Hinglish text to measure Word Error Rate (WER) and Character Error Rate (CER)..."
                value={bmReferenceText}
                onChange={(e) => setBmReferenceText(e.target.value)}
                disabled={bmLoading}
              />
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
                      <span>⚡</span> {bmLoading ? 'Evaluating Across Models...' : 'Start Benchmark & Accuracy Evaluation'}
                    </button>

                    <button
                      className="btn btn-discard"
                      onClick={discardBmAudio}
                      disabled={bmLoading}
                    >
                      <span>🗑️</span> Discard Audio
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
              <div><strong>Transcribing and calculating WER / CER across models...</strong></div>
              <p style={{ fontSize: '0.85rem', color: '#93c5fd' }}>
                Executing parallel inference, transliteration, translation, and Levenshtein metric analysis.
              </p>
            </div>
          )}

          {/* Benchmark Results */}
          {benchmarkData && (
            <div className="results-grid">
              <div className="results-meta-bar">
                <span>⏱️ Audio Duration: <strong>{benchmarkData.audio_duration}s</strong></span>
                <span>🤖 Models Evaluated: <strong>{benchmarkData.results.length}</strong></span>
                {benchmarkData.reference_text && (
                  <span className="ref-eval-tag">🎯 Reference Text Evaluated</span>
                )}
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

                        {/* WER & CER Metrics */}
                        {res.wer !== null && res.wer !== undefined && (
                          <span className={`badge ${res.wer <= 15 ? 'badge-wer-good' : res.wer <= 35 ? 'badge-wer-med' : 'badge-wer-high'}`}>
                            WER: {res.wer}%
                          </span>
                        )}
                        {res.cer !== null && res.cer !== undefined && (
                          <span className="badge badge-cer">
                            CER: {res.cer}%
                          </span>
                        )}
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