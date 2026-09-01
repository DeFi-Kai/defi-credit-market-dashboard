# Governance AI Setup

This setup runs the governance refresh on this computer, calls LM Studio on another computer, pushes the generated governance data to GitHub, and lets GitHub Pages deploy the public result.

## 1. Commit the code

From this computer:

```bash
cd /home/kai/Documents/defi-credit-market-dashboard

git add .github/workflows/pages.yml README.md governance.html governance.js governance-ai.js governance-signals.js index.html package.json styles.css scripts/fetch-governance.mjs scripts/summarize-governance.mjs scripts/refresh-governance.mjs
git commit -m "feat: add local governance synthesis refresh"
git push origin main
```

This intentionally does not stage the unrelated existing `app.js` change.

## 2. Configure LM Studio

On the other computer:

1. Load the model.
2. Start the LM Studio local server.
3. Enable network access, not only localhost.
4. Note that computer's LAN or VPN IP address.

From this computer, test connectivity:

```bash
curl http://192.168.1.50:1234/v1/models
```

Replace the IP address. You should receive JSON containing the loaded model.

If the request fails, check that LM Studio is listening on the network interface and that the remote computer's firewall allows port `1234` from this computer.

Avoid exposing the LM Studio server directly to the public internet. Use a private LAN, VPN, or secured tunnel.

## 3. Create the local environment file

```bash
mkdir -p /home/kai/.config
touch /home/kai/.config/defi-governance.env
chmod 600 /home/kai/.config/defi-governance.env
```

Add the following contents:

```bash
export LM_STUDIO_BASE_URL=http://192.168.1.50:1234/v1
export LM_STUDIO_MODEL=your-loaded-model-id
```

Replace the IP address and model ID. You can omit `LM_STUDIO_MODEL`; the script will auto-detect the first loaded model.

If the LM Studio server requires authentication, also add:

```bash
export LM_STUDIO_API_KEY=your-api-key
```

Keep this file private and never commit it.

## 4. Run the first refresh

```bash
cd /home/kai/Documents/defi-credit-market-dashboard
set -a
. /home/kai/.config/defi-governance.env
set +a
npm run refresh:governance
```

This will:

1. Fetch governance posts.
2. Preserve existing AI results.
3. Summarize new or edited posts.
4. Add the signal classification.
5. Update `data/governance.json`.
6. Commit the generated data.
7. Push the commit to GitHub.

The GitHub Pages workflow will deploy the updated public page after the push.

## 5. Add the six-hour cron job

Run:

```bash
crontab -e
```

Add:

```cron
17 */6 * * * cd /home/kai/Documents/defi-credit-market-dashboard && /usr/bin/flock -n /tmp/defi-governance-refresh.lock /bin/bash -lc 'set -a; . /home/kai/.config/defi-governance.env; set +a; exec /usr/bin/npm run refresh:governance' >> /home/kai/defi-governance-refresh.log 2>&1
```

The `flock` command prevents overlapping refresh jobs.

The computer running cron must remain powered on and connected to both the remote LM Studio computer and GitHub.

## 6. Verify the deployment

After the first successful refresh:

1. Check the GitHub repository for the new governance-data commit.
2. Check the GitHub Actions deployment workflow.
3. Open the public Governance page.
4. Confirm that summaries and signal tags appear on the posts.

The GitHub Pages workflow is deploy-only. It does not call LM Studio or overwrite locally generated governance data.
