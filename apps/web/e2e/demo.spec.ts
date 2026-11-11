import { expect, test, type Page } from '@playwright/test';

async function openQueue(page: Page) {
  await page.goto('/control-room');
  await expect(page.getByText(/REPLAY MODE/)).toBeVisible();
  await expect(
    page.getByRole('gridcell', { name: 'authorization:AUTH-48', exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
}

async function select(page: Page, target: string) {
  await page.getByRole('gridcell', { name: target, exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
}

const proposalCell = (page: Page, target: string) =>
  page.getByRole('row').filter({ has: page.getByRole('gridcell', { name: target, exact: true }) });

test.describe.configure({ mode: 'serial' });

test('queue → proposal → approve → executed', async ({ page }) => {
  await openQueue(page);
  await select(page, 'authorization:AUTH-48');
  await expect(page.getByText('R4 Bounds')).toBeVisible();
  await expect(page.getByText('AUTH-48', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Approved: QUEUED/)).toBeVisible();
  await expect(proposalCell(page, 'authorization:AUTH-48')).toContainText(/SUCCEEDED|SETTLED/, {
    timeout: 15_000,
  });
  await page.screenshot({ path: '../../docs/screenshots/control-room.png', fullPage: true });
});

test('the prompt-injection refund is blocked by policy', async ({ page }) => {
  await openQueue(page);
  await expect(proposalCell(page, 'txn:TX-2004')).toContainText('POLICY_REJECTED');
  await expect(proposalCell(page, 'txn:TX-2004')).toContainText('ESCALATED');
});

test('a simulated PayPal failure (PayPal-Mock-Response) is handled', async ({ page }) => {
  await openQueue(page);
  await select(page, 'authorization:AUTH-129');
  await page.getByLabel(/Simulate PayPal failure/).selectOption('AUTHORIZATION_EXPIRED');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(proposalCell(page, 'authorization:AUTH-129')).toContainText('FAILED_FINAL', {
    timeout: 15_000,
  });
});

test('T3 needs the typed amount', async ({ page }) => {
  await openQueue(page);
  await select(page, 'authorization:AUTH-612');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Refused: typed_amount_required/)).toBeVisible();
  await page.getByLabel('Type the exact amount to approve').fill('612.00');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(proposalCell(page, 'authorization:AUTH-612')).toContainText(/SUCCEEDED|SETTLED/, {
    timeout: 15_000,
  });
});

test('the audit log verifies its hash chain', async ({ page }) => {
  await page.goto('/audit');
  await expect(page.getByText(/Hash chain verified/)).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: '../../docs/screenshots/audit.png' });
});
