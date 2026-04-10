import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('Popup App', () => {
  it('renders the extension name', () => {
    render(<App />);
    expect(screen.getByText('MeetingScribe')).toBeInTheDocument();
  });

  it('renders the version badge', () => {
    render(<App />);
    expect(screen.getByText('v0.0.1')).toBeInTheDocument();
  });
});
