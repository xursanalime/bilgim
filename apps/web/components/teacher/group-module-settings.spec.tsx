import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { GroupModuleSettings } from './group-module-settings';
import { groupsApi, type GroupModule } from '../../lib/api/catalog';

jest.mock('../../lib/api/catalog', () => ({
  groupsApi: {
    listModules: jest.fn(),
    toggleModule: jest.fn(),
    setDownloadPermission: jest.fn(),
  },
}));

const mockListModules = groupsApi.listModules as jest.MockedFunction<
  typeof groupsApi.listModules
>;
const mockToggleModule = groupsApi.toggleModule as jest.MockedFunction<
  typeof groupsApi.toggleModule
>;
const mockSetDownloadPermission =
  groupsApi.setDownloadPermission as jest.MockedFunction<
    typeof groupsApi.setDownloadPermission
  >;

const GROUP_ID = 'g1';

function moduleOf(
  moduleType: string,
  isEnabled: boolean,
): GroupModule {
  return {
    id: `m-${moduleType}`,
    groupId: GROUP_ID,
    moduleType,
    isEnabled,
    enabledAt: isEnabled ? '2024-01-01T00:00:00.000Z' : null,
    disabledAt: isEnabled ? null : '2024-01-01T00:00:00.000Z',
  };
}

const SKILLS = [
  'WRITING',
  'READING',
  'LISTENING',
  'GRAMMAR',
  'VOCABULARY',
  'SPELLING',
  'SPEAKING',
  'PRONUNCIATION',
];

const ALL_MODULES: GroupModule[] = SKILLS.map((s) => moduleOf(s, true));

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe('GroupModuleSettings', () => {
  beforeEach(() => {
    mockListModules.mockReset();
    mockToggleModule.mockReset();
    mockSetDownloadPermission.mockReset();
    mockListModules.mockResolvedValue(ALL_MODULES);
  });

  it('renders a toggle for each of the 8 English skills', () => {
    renderWithClient(
      <GroupModuleSettings
        groupId={GROUP_ID}
        initialModules={ALL_MODULES}
        initialDownloadAllowed={false}
      />,
    );

    // 8 skill labels (in Uzbek) are present.
    expect(screen.getByText('Yozma ish')).toBeInTheDocument();
    expect(screen.getByText('Grammatika')).toBeInTheDocument();
    expect(screen.getByText('Talaffuz')).toBeInTheDocument();

    // 8 skill switches + 1 download-permission switch = 9 total.
    expect(screen.getAllByRole('switch')).toHaveLength(SKILLS.length + 1);
  });

  it('reflects the Download_Permission initial value and persists changes', async () => {
    const user = userEvent.setup();
    mockSetDownloadPermission.mockResolvedValue({
      downloadAllowed: true,
    } as never);

    renderWithClient(
      <GroupModuleSettings
        groupId={GROUP_ID}
        initialModules={ALL_MODULES}
        initialDownloadAllowed={false}
      />,
    );

    const downloadSwitch = screen.getByRole('switch', {
      name: 'Yuklab olishga ruxsat',
    });
    expect(downloadSwitch).toHaveAttribute('aria-checked', 'false');

    await user.click(downloadSwitch);

    await waitFor(() => {
      expect(mockSetDownloadPermission).toHaveBeenCalledWith(GROUP_ID, true);
    });
    expect(downloadSwitch).toHaveAttribute('aria-checked', 'true');
  });

  it('optimistically toggles a module off and calls toggleModule with the negated value', async () => {
    const user = userEvent.setup();
    mockToggleModule.mockResolvedValue(moduleOf('WRITING', false));

    renderWithClient(
      <GroupModuleSettings
        groupId={GROUP_ID}
        initialModules={ALL_MODULES}
        initialDownloadAllowed={false}
      />,
    );

    const writingSwitch = screen.getByRole('switch', { name: 'Yozma ish' });
    expect(writingSwitch).toHaveAttribute('aria-checked', 'true');

    await user.click(writingSwitch);

    // Optimistic flip is immediate.
    expect(writingSwitch).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => {
      expect(mockToggleModule).toHaveBeenCalledWith(GROUP_ID, 'WRITING', false);
    });
  });

  it('rolls back the module toggle when the request fails', async () => {
    const user = userEvent.setup();
    mockToggleModule.mockRejectedValue(new Error('boom'));

    renderWithClient(
      <GroupModuleSettings
        groupId={GROUP_ID}
        initialModules={ALL_MODULES}
        initialDownloadAllowed={false}
      />,
    );

    const readingSwitch = screen.getByRole('switch', { name: 'O\u2018qish' });
    await user.click(readingSwitch);

    // After the failure the optimistic flip is rolled back to enabled.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(readingSwitch).toHaveAttribute('aria-checked', 'true');
  });
});
