import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  test(`review text and syntax remain readable in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
    await page.goto('/');
    await expect(page.getByTestId('header/title')).toBeVisible();

    const contrasts = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const color = (token: string) => style.getPropertyValue(token).trim();
      const luminance = (hex: string) => {
        const channels = hex.replace('#', '').match(/.{2}/g);
        if (!channels || channels.length !== 3) throw new Error(`Expected hex color: ${hex}`);
        const values = channels.map(channel => {
          const value = parseInt(channel, 16) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        const [r = 0, g = 0, b = 0] = values;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (foreground: string, background: string) => {
        const a = luminance(color(foreground));
        const b = luminance(color(background));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const syntax = ['keyword', 'string', 'number', 'type', 'method', 'param', 'var', 'key', 'meta', 'comment', 'doc', 'punct'];
      const results = syntax.flatMap(role => ['--bg', '--add-bg', '--del-bg'].map(background => ({
        foreground: `--tok-${role}`, background, ratio: ratio(`--tok-${role}`, background),
      })));
      for (const foreground of ['--ink', '--ink-2', '--ink-3']) {
        for (const background of ['--bg', '--panel', '--panel-2']) {
          results.push({ foreground, background, ratio: ratio(foreground, background) });
        }
      }
      results.push({ foreground: '--on-accent', background: '--accent', ratio: ratio('--on-accent', '--accent') });
      return results;
    });

    for (const pair of contrasts) {
      expect(pair.ratio, `${pair.foreground} on ${pair.background}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}
