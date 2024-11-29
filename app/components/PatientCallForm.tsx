import React, { useState } from 'react';

interface PatientInfo {
  name?: string;
  age?: string;
  gender?: string;
  medicalHistory?: string;
}

interface ChatMessage {
  role: 'assistant' | 'user';
  content: string;
}

const PatientCallForm: React.FC = () => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [patientInfo, setPatientInfo] = useState<PatientInfo>({});
  const [status, setStatus] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setStatus('Initiating call...');

    try {
      const response = await fetch('/api/make-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phoneNumber, patientInfo }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus(`Call initiated successfully! Call SID: ${data.callSid}`);
        connectWebSocket(data.callSid);
      } else {
        throw new Error(data.error || 'Failed to initiate call');
      }
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const connectWebSocket = (callSid: string) => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/chat-updates/${callSid}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message') {
        setChatMessages(prev => [...prev, {
          role: data.role,
          content: data.content
        }]);
      }
    };

    ws.onclose = () => {
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Call ended'
      }]);
    };
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold mb-6">Make Outbound Call</h1>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="phoneNumber" className="block text-sm font-medium text-gray-700">
              Phone Number
            </label>
            <input
              type="tel"
              id="phoneNumber"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1234567890"
              pattern="^\+?[1-9]\d{1,14}$"
              required
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
            <p className="mt-1 text-sm text-gray-500">Format: +1234567890 (include country code)</p>
          </div>

          <div>
            <label htmlFor="patientName" className="block text-sm font-medium text-gray-700">
              Patient Name
            </label>
            <input
              type="text"
              id="patientName"
              value={patientInfo.name || ''}
              onChange={(e) => setPatientInfo(prev => ({ ...prev, name: e.target.value }))}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label htmlFor="medicalHistory" className="block text-sm font-medium text-gray-700">
              Medical History
            </label>
            <textarea
              id="medicalHistory"
              value={patientInfo.medicalHistory || ''}
              onChange={(e) => setPatientInfo(prev => ({ ...prev, medicalHistory: e.target.value }))}
              rows={4}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 disabled:bg-indigo-400"
          >
            {isLoading ? 'Initiating Call...' : 'Make Call'}
          </button>
        </form>

        {status && (
          <div className={`mt-4 p-4 rounded-md ${status.includes('Error') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            {status}
          </div>
        )}

        <div className="mt-6 border rounded-lg p-4 h-80 overflow-y-auto">
          <h2 className="text-lg font-semibold mb-4">Chat History</h2>
          {chatMessages.map((message, index) => (
            <div
              key={index}
              className={`mb-2 p-2 rounded-lg ${
                message.role === 'assistant'
                  ? 'bg-blue-100 mr-12'
                  : 'bg-gray-100 ml-12'
              }`}
            >
              {message.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default PatientCallForm; 