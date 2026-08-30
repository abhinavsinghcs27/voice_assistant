import React, { useState, useRef, useEffect } from 'react';
import './App.css';

export default function App() {
  const [models, setModels] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioName, setAudioName] = useState('');
  const [loading, setLoading] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState(null);
  const [error, setError] = useState(null);
  const [copiedKey, setCopiedKey] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetch('/api/models')
      .then((res) => {
        if (!res.ok) throw new Error("Could not fetch models");
        return res.json();
      })
      .then((data) => {
        setModels(data);
        // Default select all available models
        setSelectedModels(data.map(m => m.id));
      })
      .catch((err) => {
        console.error(err);
        setError("Failed to connect to backend STT service at http://127.0.0.1:8000.");
      });
  }, []);

  const toggleModelSelection = (id) => {
    setSelectedModels(prev => 
      prev.includes(id) 
        ? prev.length > 1 ? prev.filter(m => m !== id) : prev 
        : [...prev, id]
    );
  };

  const startRecording = async () => {
    setError(null);
    setBenchmarkData(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setAudioName(`mic_recording_${new Date().toISOString().slice(11, 19).replace(/:/g, '-')}.webm`);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("Mic error:", err);
      setError("Microphone access denied or audio device not found.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      clearInterval(timerRef.current);
      setIsRecording(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError(null);
    setBenchmarkData(null);
    setAudioBlob(file);
    setAudioUrl(URL.createObjectURL(file));
    setAudioName(file.name);
  };

  const discardAudio = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioBlob(null);
    setAudioUrl(null);
    setAudioName('');
    setBenchmarkData(null);
    setRecordingTime(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const runBenchmark = async () => {
    if (!audioBlob) {
      setError("No audio recording or file selected.");
      return;
    }

    if (selectedModels.length === 0) {
      setError("Please select at least one model to benchmark.");
      return;
    }

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('audio', audioBlob, audioName || 'recording.webm');
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
      setLoading(false);
    }
  };

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

  return (
    <div className="app-container">
      <header className="header-section">
        <span className="header-badge">AI Speech-to-Text Benchmark</span>
        <h1 className="app-title">Hindi & Hinglish STT Benchmark</h1>
        <p className="app-subtitle">
          Compare ultra-fast Conformer and Whisper models on Hindi & code-mixed customer speech in 3 output modalities.
        </p>
      </header>

      {error && (
        <div className="error-banner">
          <span>⚠️</span> {error}
        </div>
      )}

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
                    disabled={isRecording || loading}
                  />
                </div>
                <p className="model-desc">{m.description}</p>
              </label>
            );
          })}
        </div>
      </div>

      {/* Audio Capture & Control Card */}
      <div className="card">
        <div className="section-header">
          <div className="section-title">
            <span>🎙️</span> Audio Input
          </div>
          <span className="section-hint">Record from mic or upload audio file</span>
        </div>

        <div className="audio-capture-box">
          <div className={`mic-circle ${isRecording ? 'recording' : ''}`}>
            {isRecording ? '⏺️' : '🎙️'}
          </div>

          {isRecording && (
            <div className="recording-timer">{formatTime(recordingTime)}</div>
          )}

          <div className="btn-group">
            {!isRecording ? (
              <>
                <button
                  className="btn btn-record"
                  onClick={startRecording}
                  disabled={loading}
                >
                  <span>⏺️</span> {audioUrl ? 'Record New Audio' : 'Record Audio'}
                </button>

                <label className="btn btn-upload-label" style={{ cursor: loading ? 'not-allowed' : 'pointer' }}>
                  <span>📁</span> Upload Audio File
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,.wav,.mp3,.webm,.m4a,.ogg"
                    style={{ display: 'none' }}
                    onChange={handleFileUpload}
                    disabled={loading}
                  />
                </label>
              </>
            ) : (
              <button className="btn btn-stop" onClick={stopRecording}>
                <span>⏹️</span> Stop Recording
              </button>
            )}
          </div>

          {/* Audio Preview & Action Bar */}
          {audioUrl && !isRecording && (
            <div className="audio-preview-box">
              <div className="audio-preview-header">
                <span>🎵 <strong>{audioName || 'Audio Ready'}</strong></span>
                <span>Ready to Benchmark</span>
              </div>
              
              <audio controls src={audioUrl} />

              <div className="btn-group" style={{ marginTop: '0.75rem' }}>
                <button
                  className="btn btn-primary"
                  onClick={runBenchmark}
                  disabled={loading || selectedModels.length === 0}
                >
                  <span>⚡</span> {loading ? 'Transcribing Across Models...' : 'Start Transcribing & Compare'}
                </button>

                <button
                  className="btn btn-discard"
                  onClick={discardAudio}
                  disabled={loading}
                >
                  <span>🗑️</span> Discard Recording
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Loading Box */}
      {loading && (
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
  );
}