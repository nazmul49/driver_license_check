# Deploying on an Oracle Cloud Always Free VM

This runs the whole stack (Caddy for HTTPS, API, worker, MySQL 8) on one free ARM VM with Docker Compose. It is meant for demos and testing with synthetic cards.

Do not process real identity documents on this setup without legal and privacy review (SPEC 12). For Sharebox, real personal data must follow Sharebox's data handling process, which a personal free-tier VM does not meet.

Oracle's free tier terms and console labels change over time. The steps below were written in October 2026; check the current Oracle documentation if a screen looks different.

## What you need

- An Oracle Cloud account (sign-up asks for a card for identity verification).
- A hostname pointing at the VM. A free DuckDNS subdomain (`yourname.duckdns.org`) works.
- About 30 minutes.

## 1. Create the VM

1. In the Oracle Cloud console: Compute, Instances, Create instance.
2. Image: Canonical Ubuntu 24.04 (aarch64). Shape: Ampere `VM.Standard.A1.Flex` with 4 OCPU and 24 GB memory (or 2 OCPU / 12 GB if you want headroom in the free allowance).
3. Networking: keep the default VCN with a public subnet and assign a public IPv4 address.
4. Add your SSH public key and create the instance. Note the public IP.

If creation fails with "out of capacity", try another availability domain or try again later; free Ampere capacity is limited in some regions.

## 2. Open ports 80 and 443

Two layers block traffic by default, and both need opening.

Cloud firewall: in the instance's subnet, open the security list (or network security group) and add ingress rules for source `0.0.0.0/0`, TCP, destination ports `80` and `443`. Add UDP `443` too if you want HTTP/3.

Host firewall: Oracle's Ubuntu images ship iptables rules that reject everything except SSH. On the VM:

```sh
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Point your hostname at the VM

For DuckDNS: sign in at duckdns.org, create a subdomain and set its IP to the VM's public IP. Check with `dig +short yourname.duckdns.org` before continuing; Caddy needs DNS to resolve to get a certificate.

## 4. Install Docker

```sh
ssh ubuntu@<public-ip>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit   # log in again so the group change applies
```

## 5. Get the code and configure

```sh
ssh ubuntu@<public-ip>
git clone https://github.com/nazmul49/driver_license_check.git
cd driver_license_check
deploy/init-env.sh yourname.duckdns.org you@example.com
```

`init-env.sh` creates `deploy/.env` (mode 600) and generates every password and secret. It never overwrites a value that is already set, because changing the encryption key or API key pepper later makes stored data and API keys unusable.

Copy `ENCRYPTION_MASTER_KEY` from `deploy/.env` into your password manager now. Backups cannot be decrypted without it.

Other settings in `deploy/.env` (retention days, OCR pool size, log level) can be edited before starting.

## 6. Start

```sh
alias dlc='docker compose -f deploy/compose.yml --env-file deploy/.env'
dlc up -d --build                                   # first build takes a few minutes
dlc run --rm api npm run migrate -w server
dlc ps                                              # api healthy, mysql healthy
curl https://yourname.duckdns.org/v1/ready
```

Caddy gets a Let's Encrypt certificate on first request. If `/v1/ready` fails with a TLS error, check `dlc logs caddy`: usually DNS is not pointing at the VM yet or port 80 is still blocked.

## 7. Create an integrator and API key

```sh
dlc run --rm api npm run cli -w server -- integrator:create \
  --name demo --display-name "Demo" --hosts yourname.duckdns.org,localhost --allow-reopen
dlc run --rm api npm run cli -w server -- key:create --integrator <integrator-id> --mode test
```

Both commands print a secret once (webhook secret, API key). Store them; do not paste them into chats or tickets.

`--hosts` is the allowlist for `return_url` and `webhook_url` hosts. Then follow `docs/integration.md` to create a session and open its `hosted_url` on your phone.

## Operating it

- Logs: `dlc logs -f api worker` (JSON, no document data; rotated at 10 MB x 5 files per container).
- Update to the latest code: `git pull && dlc up -d --build && dlc run --rm api npm run migrate -w server`.
- Stop: `dlc down` (data volumes are kept). `dlc down -v` deletes the database and images.
- Metrics: `/metrics` is blocked at Caddy. From the VM: `dlc exec api node -e "fetch('http://127.0.0.1:3000/metrics',{headers:{authorization:'Bearer '+process.env.METRICS_TOKEN}}).then(r=>r.text()).then(console.log)"`; the worker serves its own on port 9464 inside the Docker network.

## Backups

`deploy/backup.sh` writes a gzipped MySQL dump and an archive of the (encrypted) image volume to `~/dlc-backups`, keeping 7 days:

```sh
crontab -e
# add:
15 3 * * * /home/ubuntu/driver_license_check/deploy/backup.sh >> /home/ubuntu/dlc-backup.log 2>&1
```

Backups on the same VM do not survive losing the VM. Copy them elsewhere if the data matters, and remember the encryption key is not in the backup.

## Resource notes

On 4 OCPU / 24 GB, the defaults (`OCR_POOL_SIZE=3`, `WORKER_CONCURRENCY=2`) leave room for MySQL and the API. The load test on a laptop gave p95 1.24 s per session for the OCR stage; expect slower on Ampere cores, and run `npm run loadtest -w server` on the VM if you need a real number.
