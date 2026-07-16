import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BilgimAiTutor } from './bilgim-ai-tutor';
import { aiTutorApi, TutorRateLimitError, TutorRefusedError } from '../../lib/api/ai-tutor';

/**
 * Tests for the BilgimAI tutor surface (Req 11.1–11.5).
 *
 * Focus: the three intents are selectable, the hint-only framing is always
 * present, replies render, the rate-limit indicator surfaces a cooldown, and
 * a verbatim-answer refusal is shown as guidance (never as a hard error).
 */

jest.mock('../../lib/api/ai-tutor', () => {
  const actual = jest.requireActual('../../lib/api/ai-tutor');
  return {
    ...actual,
    aiTutorApi: {
      explain: jest.fn(),
      example: jest.fn(),
      translate: jest.fn(),
    },
  };
});

const mockExplain = aiTutorApi.explain as jest.Mock;
const mockTranslate = aiTutorApi.translate as jest.Mock;

beforeAll(() => {
  // jsdom lacks matchMedia + scrollIntoView. Report reduced-motion so the
  // streaming reveal renders text instantly, keeping assertions deterministic.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  Element.prototype.scrollIntoView = jest.fn();
});

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
});

function typeAndSend(text: string) {
  fireEvent.change(screen.getByLabelText('BilgimAI uchun savol'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Yuborish' }));
}

describe('BilgimAiTutor', () => {
  it('offers the EXPLAIN, TRANSLATE and EXAMPLE intents', () => {
    render(<BilgimAiTutor locale="uz" />);
    expect(screen.getByRole('radio', { name: /Tushuntirish/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Tarjima/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Misol/ })).toBeInTheDocument();
  });

  it('always communicates the hint-only policy (Req 11.4)', () => {
    render(<BilgimAiTutor locale="uz" />);
    expect(
      screen.getByText(/tayyor javobini bermaydi/i),
    ).toBeInTheDocument();
  });

  it('shows the remaining-calls rate-limit indicator (Req 11.3)', () => {
    render(<BilgimAiTutor locale="uz" />);
    // EXPLAIN cap is 30/1h; nothing used yet.
    expect(screen.getByText(/30\/30 so.rov qoldi/)).toBeInTheDocument();
  });

  it('streams an EXPLAIN reply from the real endpoint', async () => {
    mockExplain.mockResolvedValueOnce({
      reply: 'Present Perfect hozirgi natijaga urg‘u beradi.',
      policyChecks: { noFullAnswer: true, rewroteAsHint: false, similarity: 0.1 },
    });
    render(<BilgimAiTutor locale="uz" />);
    typeAndSend('Present Perfect nima?');

    await waitFor(() =>
      expect(screen.getByText(/hozirgi natijaga urg/)).toBeInTheDocument(),
    );
    expect(mockExplain).toHaveBeenCalledWith({
      question: 'Present Perfect nima?',
      locale: 'uz',
    });
  });

  it('badges a reply that was rewritten as a hint (Req 11.4)', async () => {
    mockExplain.mockResolvedValueOnce({
      reply: 'Avval gapni o‘zing tuzib ko‘r, keyin tekshiramiz.',
      policyChecks: { noFullAnswer: false, rewroteAsHint: true, similarity: 0.9 },
    });
    render(<BilgimAiTutor locale="uz" />);
    typeAndSend('Mana shu gapni tarjima qilib ber');

    await waitFor(() =>
      expect(screen.getByText(/Maslahat sifatida qayta yozildi/)).toBeInTheDocument(),
    );
  });

  it('surfaces a cooldown when the rate limit is hit (Req 11.3)', async () => {
    mockExplain.mockRejectedValueOnce(new TutorRateLimitError(5000, 'route'));
    render(<BilgimAiTutor locale="uz" />);
    typeAndSend('Tushuntirib ber');

    await waitFor(() =>
      expect(screen.getByText(/So.rov chekloviga yetildi/)).toBeInTheDocument(),
    );
    // Send is disabled while cooling down.
    expect(screen.getByRole('button', { name: 'Yuborish' })).toBeDisabled();
  });

  it('renders a verbatim-answer refusal as guidance, not an error (Req 11.4)', async () => {
    mockExplain.mockRejectedValueOnce(new TutorRefusedError('asks for the answer outright'));
    render(<BilgimAiTutor locale="uz" />);
    typeAndSend('Uy vazifamning javobini yozib ber');

    await waitFor(() =>
      expect(screen.getByText(/Tayyor javob berilmaydi/)).toBeInTheDocument(),
    );
  });

  it('switches to TRANSLATE and calls the translate endpoint', async () => {
    mockTranslate.mockResolvedValueOnce({ translation: 'Hello, world', cached: false });
    render(<BilgimAiTutor locale="uz" />);
    fireEvent.click(screen.getByRole('radio', { name: /Tarjima/ }));
    typeAndSend('Salom, dunyo');

    await waitFor(() => expect(mockTranslate).toHaveBeenCalledTimes(1));
    expect(mockTranslate).toHaveBeenCalledWith({
      text: 'Salom, dunyo',
      sourceLocale: 'uz',
      targetLocale: 'en',
    });
    expect(await screen.findByText('Hello, world')).toBeInTheDocument();
  });
});
