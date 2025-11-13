import React, { useState } from 'react';
import { ImageWorkflow } from './components/ImageWorkflow';
import { VersionHistory } from './components/VersionHistory';
import { Demo } from './components/Demo';
import { PhotoIcon, ListBulletIcon, CodeBracketIcon, SparklesIcon } from './components/Icons';
import { SessionData, PreSessionState, SigScheme } from './types';

type Tab = 'workflow' | 'history' | 'demo';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('workflow');
  const [session, setSession] = useState<SessionData | null>(null);
  const [preSessionState, setPreSessionState] = useState<PreSessionState>({
    signerInput: '',
    sigScheme: SigScheme.RSA,
  });

  const handleSessionUpdate = (newSession: SessionData | null) => {
    setSession(newSession);
    if (newSession === null) {
      // If the session is reset, also reset the pre-session form state.
      setPreSessionState({ signerInput: '', sigScheme: SigScheme.RSA });
    }
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'workflow':
        return (
          <ImageWorkflow
            session={session}
            onSessionUpdate={handleSessionUpdate}
            preSessionState={preSessionState}
            onPreSessionStateChange={setPreSessionState}
          />
        );
      case 'history':
        return <VersionHistory session={session} />;
      case 'demo':
        return <Demo />;
      default:
        return null;
    }
  };

  const TabButton = ({ tab, label, icon }: { tab: Tab; label: string; icon: React.ReactElement }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`flex items-center justify-center w-full px-4 py-3 font-semibold text-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 rounded-md ${
        activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
      }`}
    >
      {icon}
      <span className="ml-2">{label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-7xl mx-auto">
        <header className="mb-8 space-y-4 text-center">
          <div className="flex items-center justify-center gap-3">
            <CodeBracketIcon className="h-10 w-10 text-blue-500" />
            <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight">
              ImageChain
            </h1>
          </div>
          <p className="text-lg text-gray-400">
            Secure image version control embedded directly into your pixels. Offline, cryptographic,
            and tamper-evident.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
            <span className="rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-green-200">
              Offline · Browser Native
            </span>
            <span className="rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-blue-200">
              RSA-3072 / ECC P-256 Signatures
            </span>
          </div>
        </header>

        <nav className="mb-8 p-2 bg-gray-800 rounded-lg shadow-lg">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <TabButton tab="workflow" label="Workflow" icon={<PhotoIcon />} />
            <TabButton tab="history" label="Version History" icon={<ListBulletIcon />} />
            <TabButton tab="demo" label="Automated Demo" icon={<SparklesIcon />} />
          </div>
        </nav>

        <main className="bg-gray-800 p-4 sm:p-6 rounded-lg shadow-lg min-h-[60vh]">
          {renderTabContent()}
        </main>
        
        <footer className="text-center mt-8 text-gray-500 text-sm">
          <p>This application operates entirely offline. Your files and keys never leave your browser.</p>
        </footer>
      </div>
    </div>
  );
};

export default App;
