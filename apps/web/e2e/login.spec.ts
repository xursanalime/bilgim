import { test, expect } from '@playwright/test';

/**
 * Login smoke test (Task: best-effort e2e setup).
 *
 * This intentionally does NOT try to authenticate against a real/dev
 * database — there's no guaranteed test account, and asserting a
 * successful login would make this test flaky/environment-dependent. The
 * goal is just to prove the page renders its accessible form fields and
 * that submitting doesn't blow up client-side (no uncaught exception, no
 * unhandled promise rejection) — the actual auth outcome (success, invalid
 * credentials, rate limit, etc.) is out of scope here.
 */
test.describe('Login page', () => {
  test('renders the login form and submits without a client-side crash', async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (error) => pageErrors.push(error));

    await page.goto('/login');

    // Accessible role/label selectors — resilient to markup/class changes.
    const emailField = page.getByLabel('Email', { exact: true });
    const passwordField = page.getByLabel('Parol', { exact: true });
    const submitButton = page.getByRole('button', { name: 'Kirish' });

    await expect(emailField).toBeVisible();
    await expect(passwordField).toBeVisible();
    await expect(submitButton).toBeVisible();

    await emailField.fill('smoke-test@example.com');
    await passwordField.fill('Sm0ke-Test-Password!');
    await submitButton.click();

    // Give the client time to process the submit (validation, the API
    // call and its rejection/resolution, any resulting re-render) without
    // asserting a specific outcome.
    await page.waitForTimeout(1000);

    expect(pageErrors, `Unexpected client-side error(s): ${pageErrors.map((e) => e.message).join('; ')}`).toHaveLength(0);
  });
});
