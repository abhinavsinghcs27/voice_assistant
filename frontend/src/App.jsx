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
  const [sttModel, setSttModel] = useState('indic-conformer-onnx');
  const [vaRecording, setVaRecording] = useState(false);
  const [vaTimer, setVaTimer] = useState(0);
  const [vaAudioBlob, setVaAudioBlob] = useState(null);
  const [vaAudioUrl, setVaAudioUrl] = useState(null);
  const [vaAudioName, setVaAudioName] = useState('');
  const [vaPipelineStage, setVaPipelineStage] = useState('idle'); // 'idle' | 'stt' | 'llm' | 'tts' | 'ready'
  const [vaResult, setVaResult] = useState(null);
  const [vaLoading, setVaLoading] = useState(false);

  // Refs
  const bmMediaRecorderRef = useRef(null);
  const bmAudioChunksRef = useRef([]);
  const bmTimerRef = useRef(null);
  const bmFileInputRef = useRef(null);

  const vaMediaRecorderRef = useRef(null);
  const vaAudioChunksRef = useRef([]);
  const vaTimerRef = useRef(null);
  const vaFileInputRef = useRef(null);
  const vaAudioPlayerRef = useRef(null);

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
  const startVaRecording = async () => {
    setError(null);
    setVaResult(null);
    setVaPipelineStage('idle');
    vaAudioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';

      vaMediaRecorderRef.current = new MediaRecorder(stream, { mimeType });
      vaMediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) vaAudioChunksRef.current.push(e.data);
      };
      vaMediaRecorderRef.current.onstop = () => {
        const blob = new Blob(vaAudioChunksRef.current, { type: mimeType });
        setVaAudioBlob(blob);
        setVaAudioUrl(URL.createObjectURL(blob));
        setVaAudioName(`mic_va_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.webm`);
      };

      vaMediaRecorderRef.current.start();
      setVaRecording(true);
      setVaTimer(0);
      vaTimerRef.current = setInterval(() => setVaTimer(prev => prev + 1), 1000);
    } catch (err) {
      console.error(err);
      setError("Microphone access denied or audio device not found.");
    }
  };

  const stopVaRecording = () => {
    if (vaMediaRecorderRef.current && vaRecording) {
      vaMediaRecorderRef.current.stop();
      vaMediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      clearInterval(vaTimerRef.current);
      setVaRecording(false);
    }
  };

  const handleVaFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setError(null);
    setVaResult(null);
    setVaPipelineStage('idle');
    setVaAudioBlob(file);
    setVaAudioUrl(URL.createObjectURL(file));
    setVaAudioName(file.name);
  };

  const discardVaAudio = () => {
    if (vaAudioUrl) URL.revokeObjectURL(vaAudioUrl);
    setVaAudioBlob(null);
    setVaAudioUrl(null);
    setVaAudioName('');
    setVaResult(null);
    setVaPipelineStage('idle');
    setVaTimer(0);
    if (vaFileInputRef.current) vaFileInputRef.current.value = '';
  };

  const runVoiceAssistant = async () => {
    if (!vaAudioBlob) {
      setError("No audio recording or file selected.");
      return;
    }

    setVaLoading(true);
    setError(null);
    setVaPipelineStage('stt');

    const formData = new FormData();
    formData.append('audio', vaAudioBlob, vaAudioName || 'voice_query.webm');
    formData.append('stt_model', sttModel);

    // Simulate progress updates for stages
    const stageTimer1 = setTimeout(() => setVaPipelineStage('llm'), 600);
    const stageTimer2 = setTimeout(() => setVaPipelineStage('tts'), 1400);

    try {
      const response = await fetch('/api/voice-assistant/interact', {
        method: 'POST',
        body: formData,
      });

      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Voice Assistant pipeline execution failed.');
      }

      const data = await response.json();
      setVaResult(data);
      setVaPipelineStage('ready');

      // Auto-play AI response audio
      if (data.audio_url) {
        setTimeout(() => {
          if (vaAudioPlayerRef.current) {
            vaAudioPlayerRef.current.play().catch(e => console.log("Auto-play prevented by browser:", e));
          }
        }, 300);
      }
    } catch (err) {
      setError(err.message);
      setVaPipelineStage('idle');
    } finally {
      setVaLoading(false);
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
      {/* TAB 1: VOICE ASSISTANT PIPELINE */}
      {/* ==================================================================== */}
      {activeTab === 'assistant' && (
        <div className="tab-content">
          {/* Controls & Engine Selection */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <span>⚡</span> Pipeline Engine Settings
              </div>
              <span className="section-hint">STT Model + Groq LLM + gTTS</span>
            </div>

            <div className="assistant-settings-grid">
              <div className="setting-box">
                <label className="setting-label">Speech Recognition (STT)</label>
                <select 
                  className="setting-select"
                  value={sttModel}
                  onChange={(e) => setSttModel(e.target.value)}
                  disabled={vaRecording || vaLoading}
                >
                  {models.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} {m.id === 'indic-conformer-onnx' ? '⚡ (Sub-200ms CPU)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="setting-box">
                <label className="setting-label">LLM Engine (Reasoning)</label>
                <div className="static-badge-box">
                  🤖 <strong>Groq openai/gpt-oss-20b</strong> <span className="speed-tag">Sub-500ms</span>
                </div>
              </div>

              <div className="setting-box">
                <label className="setting-label">Voice Synthesis (TTS)</label>
                <div className="static-badge-box">
                  🔊 <strong>gTTS In-Memory Neural Voice</strong> <span className="speed-tag">MP3 Stream</span>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Audio Capture Card */}
          <div className="card">
            <div className="section-header">
              <div className="section-title">
                <span>🎙️</span> User Voice Query
              </div>
              <span className="section-hint">Speak in Hindi or Hinglish</span>
            </div>

            <div className="audio-capture-box">
              <div className={`mic-circle ${vaRecording ? 'recording' : ''}`}>
                {vaRecording ? '⏺️' : '🎙️'}
              </div>

              {vaRecording && (
                <div className="recording-timer">{formatTime(vaTimer)}</div>
              )}

              <div className="btn-group">
                {!vaRecording ? (
                  <>
                    <button
                      className="btn btn-record"
                      onClick={startVaRecording}
                      disabled={vaLoading}
                    >
                      <span>⏺️</span> {vaAudioUrl ? 'Record New Query' : 'Speak Now'}
                    </button>

                    <label className="btn btn-upload-label" style={{ cursor: vaLoading ? 'not-allowed' : 'pointer' }}>
                      <span>📁</span> Upload Audio File
                      <input
                        ref={vaFileInputRef}
                        type="file"
                        accept="audio/*,.wav,.mp3,.webm,.m4a,.ogg"
                        style={{ display: 'none' }}
                        onChange={handleVaFileUpload}
                        disabled={vaLoading}
                      />
                    </label>
                  </>
                ) : (
                  <button className="btn btn-stop" onClick={stopVaRecording}>
                    <span>⏹️</span> Stop & Process
                  </button>
                )}
              </div>

              {/* Audio Preview & Interact Button */}
              {vaAudioUrl && !vaRecording && (
                <div className="audio-preview-box">
                  <div className="audio-preview-header">
                    <span>🎵 <strong>{vaAudioName || 'User Audio Ready'}</strong></span>
                    <span>Ready for AI Processing</span>
                  </div>
                  
                  <audio controls src={vaAudioUrl} />

                  <div className="btn-group" style={{ marginTop: '0.75rem' }}>
                    <button
                      className="btn btn-primary btn-interact"
                      onClick={runVoiceAssistant}
                      disabled={vaLoading}
                    >
                      <span>⚡</span> {vaLoading ? 'Processing Voice Assistant Loop...' : 'Send Voice Query to Assistant'}
                    </button>

                    <button
                      className="btn btn-discard"
                      onClick={discardVaAudio}
                      disabled={vaLoading}
                    >
                      <span>🗑️</span> Discard
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Pipeline Stage Indicator */}
          {vaLoading && (
            <div className="pipeline-status-card">
              <div className="pipeline-steps">
                <div className={`pipeline-step ${vaPipelineStage === 'stt' ? 'active' : 'done'}`}>
                  <span className="step-icon">⚡</span>
                  <span className="step-label">1. STT Audio Transcription</span>
                </div>
                <div className="step-arrow">→</div>
                <div className={`pipeline-step ${vaPipelineStage === 'llm' ? 'active' : vaPipelineStage === 'tts' || vaPipelineStage === 'ready' ? 'done' : ''}`}>
                  <span className="step-icon">🧠</span>
                  <span className="step-label">2. Groq LLM Reasoning</span>
                </div>
                <div className="step-arrow">→</div>
                <div className={`pipeline-step ${vaPipelineStage === 'tts' ? 'active' : vaPipelineStage === 'ready' ? 'done' : ''}`}>
                  <span className="step-icon">🔊</span>
                  <span className="step-label">3. gTTS Voice Synthesis</span>
                </div>
              </div>
            </div>
          )}

          {/* Assistant Result Card */}
          {vaResult && (
            <div className="va-response-container">
              {/* Latency Summary Bar */}
              <div className="latency-bar">
                <span className="latency-chip total">
                  ⚡ <strong>Total Turn: {vaResult.latency.total_seconds}s</strong>
                </span>
                <span className="latency-chip">
                  🎙️ STT: {vaResult.latency.stt_seconds}s
                </span>
                <span className="latency-chip">
                  🧠 LLM: {vaResult.latency.llm_seconds}s
                </span>
                <span className="latency-chip">
                  🔊 TTS: {vaResult.latency.tts_seconds}s
                </span>
              </div>

              <div className="dialogue-grid">
                {/* User Spoken Input Card */}
                <div className="dialogue-card user-card">
                  <div className="dialogue-header">
                    <span className="user-tag">👤 User Spoken Speech</span>
                    <button 
                      className="copy-btn"
                      onClick={() => copyToClipboard(vaResult.user_transcript.devanagari || vaResult.user_transcript.raw, 'user_text')}
                    >
                      {copiedKey === 'user_text' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>

                  <div className="transcript-box devanagari-text">
                    {vaResult.user_transcript.devanagari || vaResult.user_transcript.raw || '(No speech recognized)'}
                  </div>

                  {vaResult.user_transcript.romanised && (
                    <div className="sub-transcript-block">
                      <span className="sub-tag">🔤 Hinglish:</span> {vaResult.user_transcript.romanised}
                    </div>
                  )}

                  {vaResult.user_transcript.english && (
                    <div className="sub-transcript-block">
                      <span className="sub-tag">🌐 English:</span> {vaResult.user_transcript.english}
                    </div>
                  )}
                </div>

                {/* AI Spoken Response Card */}
                <div className="dialogue-card assistant-card">
                  <div className="dialogue-header">
                    <span className="ai-tag">🤖 AI Spoken Response ({vaResult.llm_response.model_used})</span>
                    <button 
                      className="copy-btn"
                      onClick={() => copyToClipboard(vaResult.llm_response.text, 'ai_text')}
                    >
                      {copiedKey === 'ai_text' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>

                  <div className="assistant-text-box">
                    "{vaResult.llm_response.text}"
                  </div>

                  {/* Audio Player for Voice Response */}
                  {vaResult.audio_url && (
                    <div className="ai-audio-player-wrapper">
                      <span className="player-title">🔊 Listen to AI Voice Response:</span>
                      <audio 
                        ref={vaAudioPlayerRef} 
                        controls 
                        autoPlay 
                        src={vaResult.audio_url} 
                      />
                    </div>
                  )}
                </div>
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