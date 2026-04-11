/**
 * MeetingScribe — Options page.
 *
 * Four sections: Connected Accounts, Routing Rules, Notes Template, General Settings.
 */

import { useState } from 'react';
import { ConnectedAccounts } from './components/ConnectedAccounts';
import { RoutingRules } from './components/RoutingRules';
import { NotesTemplate } from './components/NotesTemplate';
import { DocumentTemplates } from './components/DocumentTemplates';
import { GeneralSettings } from './components/GeneralSettings';

type Tab = 'accounts' | 'routing' | 'template' | 'doctemplate' | 'settings';

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>('accounts');

  return (
    <div className="max-w-3xl mx-auto p-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-on-surface">MeetingScribe Settings</h1>
        <p className="mt-1 text-sm text-on-surface-muted">
          Manage connected accounts, routing rules, and preferences.
        </p>
      </header>

      {/* Tab navigation */}
      <nav className="flex gap-1 border-b border-surface-bright mb-6">
        <TabButton label="Accounts" active={activeTab === 'accounts'} onClick={() => setActiveTab('accounts')} />
        <TabButton label="Routing Rules" active={activeTab === 'routing'} onClick={() => setActiveTab('routing')} />
        <TabButton label="Notes Template" active={activeTab === 'template'} onClick={() => setActiveTab('template')} />
        <TabButton label="Doc Template" active={activeTab === 'doctemplate'} onClick={() => setActiveTab('doctemplate')} />
        <TabButton label="General" active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
      </nav>

      {/* Tab content */}
      {activeTab === 'accounts' && <ConnectedAccounts />}
      {activeTab === 'routing' && <RoutingRules />}
      {activeTab === 'template' && <NotesTemplate />}
      {activeTab === 'doctemplate' && <DocumentTemplates />}
      {activeTab === 'settings' && <GeneralSettings />}
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
        active
          ? 'border-brand-500 text-brand-600'
          : 'border-transparent text-on-surface-muted hover:text-on-surface hover:border-surface-bright'
      }`}
    >
      {label}
    </button>
  );
}
