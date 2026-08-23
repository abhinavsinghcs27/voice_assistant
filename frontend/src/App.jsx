import React, { useState, useRef, useEffect } from 'react';
import './App.css';

export default function App() {
  const [models, setModels] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [benchmarkData, setBenchmarkData] = useState(null);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);

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
        setError("Failed to connect to backend STT service.");
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
        setAudioUrl(URL.createObjectURL(blob));
        runBenchmark(blob);
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

  const runBenchmark = async (blob) => {
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
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

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return (
    <div className="container">
      <h1>Hindi / Hinglish STT Multi-Model Benchmark</h1>

      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="section-title">Models to Compare</div>
        <div className="model-checkbox-group">
          {models.map((m) => (
            <label key={m.id} className="checkbox-card">
              <input
                type="checkbox"
                checked={selectedModels.includes(m.id)}
                onChange={() => toggleModelSelection(m.id)}
                disabled={isRecording || loading}
              />
              <div>
                <span className="checkbox-title">{m.name}</span>
                <p className="checkbox-desc">{m.description}</p>
              </div>
            </label>
          ))}
        </div>

        <div className="mic-section">
          <div className={`mic-btn ${isRecording ? 'recording' : ''}`}>🎙️</div>
          <div className="timer">{formatTime(recordingTime)}</div>

          <div className="btn-row">
            {!isRecording ? (
              <button
                className="action-btn start"
                onClick={startRecording}
                disabled={loading || selectedModels.length === 0}
              >
                {loading ? 'Running Benchmark Across Models...' : 'Record & Compare Models'}
              </button>
            ) : (
              <button className="action-btn stop" onClick={stopRecording}>
                Stop & Run Benchmark
              </button>
            )}
          </div>
        </div>

        {audioUrl && (
          <div className="audio-preview">
            <div className="section-title">Test Audio</div>
            <audio controls src={audioUrl} />
          </div>
        )}
      </div>

      {loading && (
        <div className="card loading-indicator">
          ⏳ Transcribing across selected models. The first time a new model runs, it will download weights...
        </div>
      )}

      {benchmarkData && (
        <div className="comparison-grid">
          <div className="audio-meta">
            Audio Length: <strong>{benchmarkData.audio_duration}s</strong> | Evaluated Models: <strong>{benchmarkData.results.length}</strong>
          </div>

          <div className="results-cards">
            {benchmarkData.results.map((res) => (
              <div className="card result-card" key={res.model_id}>
                <div className="result-header">
                  <h3>{res.model_name}</h3>
                  <span className={`rtf-badge ${res.real_time_factor <= 1.0 ? 'rtf-fast' : 'rtf-slow'}`}>
                    RTF: {res.real_time_factor}x
                  </span>
                </div>

                <div className="result-metric-row">
                  <span>Processing Time: <strong>{res.processing_time}s</strong></span>
                </div>

                <div className="section-title" style={{ marginTop: '1rem' }}>Transcript</div>
                <div className="transcript-box">{res.transcript || '(No speech recognized)'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}