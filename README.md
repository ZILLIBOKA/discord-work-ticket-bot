# Discord Work Ticket Bot

업무용 티켓 처리를 위한 디스코드 봇과 웹 대시보드입니다.

## 1. 기능 요약
- 티켓 타입 4종 모달 입력
  - `Job Ticket`: Date, TS, Location, Fault
  - `Material Use Ticket`: Date, Job No, Material with S/N
  - `Defected Material Ticket`: Date, Job No, Material with S/N
  - `General Ticket`: Date, 문의 내용
- 티켓 채널 생성, Claim, Close
- 매니저(사용자/역할) 권한 부여
- Open/Closed 티켓 이력 조회
- 대시보드에서 임베드 공지 발송

## 2. 사전 준비
### 2.1 Discord Developer Portal 설정
1. [Discord Developer Portal](https://discord.com/developers/applications)에서 앱 생성
2. `Bot` 탭에서 봇 생성 후 토큰 발급
3. `Privileged Gateway Intents` 활성화
- `Message Content Intent`
- `Server Members Intent`
4. 봇 초대 링크 생성 후 서버에 초대

### 2.2 로컬 환경
- Node.js 18+
- macOS 또는 Linux

## 3. 환경 변수 설정
`discord-bot/.env` 파일 생성:

```env
DISCORD_TOKEN=발급받은_봇_토큰
DASHBOARD_TOKEN=대시보드_접속_토큰
DASHBOARD_PORT=8787
SLASH_GUILD_ID=슬래시명령_즉시반영_테스트용_서버ID
ENABLE_GUILD_MEMBERS_INTENT=false
ENABLE_MESSAGE_CONTENT_INTENT=false

# 선택
PREFIX=!
OWNER_USER_ID=
GOOGLE_SHEET_ID=
GOOGLE_SHEET_RANGE=JobList!A:Z
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_SERVICE_ACCOUNT_FILE=
```

설명:
- `DISCORD_TOKEN`: 봇 로그인 필수
- `DASHBOARD_TOKEN`: 대시보드 API 인증 토큰
- `DASHBOARD_PORT`: 대시보드 로컬 포트
- `SLASH_GUILD_ID`: 지정 시 해당 서버에 슬래시 명령을 즉시 반영(개발/테스트 권장)
- `ENABLE_GUILD_MEMBERS_INTENT`: 멤버 인텐트 사용 여부 (`true/false`)
- `ENABLE_MESSAGE_CONTENT_INTENT`: 메시지 내용 인텐트 사용 여부 (`true/false`)

## 4. 실행
```bash
cd "/Users/sunghyunhwang/Documents/New project/discord-bot"
npm install
node index.js
```

실행 후:
- 봇: 디스코드 서버에서 온라인 상태 확인
- 대시보드: `http://localhost:8787`

## 5. 최초 운영 설정 (디스코드에서 실행)
아래 명령은 서버 관리자 권한 계정으로 실행합니다.

1. 역할 연결
- `!ticket technician @TechnicianRole`
- `!ticket engineer @EngineerRole`
- `!ticket support @SupportRole` (선택)

2. 채널 연결
- `!ticket category #ticket-category`
- `!ticket log #ticket-log`
- `!ticket forum #worklog-forum` (선택)

3. 패널 생성
- `!ticket panel`

4. 확인
- `!ticket status`

## 6. 티켓 사용 방법
### 6.1 테크니션
- 패널의 `Create Ticket` 버튼 클릭
- 티켓 타입 선택
- 모달 입력 후 제출

또는 슬래시 명령으로 생성:
- `/open type:job`
- `/open type:material_use`
- `/open type:defected_material`
- `/open type:general`

`/open` 실행 시 선택한 타입에 맞는 모달폼이 열리고, 입력 후 제출하면 티켓 채널이 생성됩니다.

### 6.2 매니저/엔지니어
- 티켓 채널에서 `Claim` 버튼 또는 `/claim`
- 처리 완료 시 `Close` 버튼 또는 `/close reason:...`

## 7. 매니저 권한 관리
### 7.1 디스코드 명령
- 조회: `!ticket manager list`
- 사용자 추가: `!ticket manager add @user`
- 역할 추가: `!ticket manager add @role`
- 제거: `!ticket manager remove @user` 또는 `!ticket manager remove @role`

### 7.2 대시보드
1. `http://localhost:8787` 접속
2. `DASHBOARD_TOKEN` 입력
3. 서버 선택
4. `관리자 권한` 영역에서 사용자/역할 추가/제거

## 8. 대시보드 상세
대시보드에서 가능한 작업:
- Open Tickets 목록 확인
- Closed Tickets 이력 확인
- 매니저 사용자/역할 관리
- 특정 서버/채널 임베드 공지 전송

임베드 공지 전송 절차:
1. 서버 선택
2. 채널 선택
3. 제목/색상/내용 입력
4. `임베드 전송` 클릭

## 9. 외부 인터넷 공개 (Cloudflare Tunnel)
> 대시보드를 외부에서 접속할 때만 사용

시작:
```bash
cd "/Users/sunghyunhwang/Documents/New project/discord-bot"
bash scripts/manage_tunnel.sh start
bash scripts/manage_tunnel.sh status
```

중지:
```bash
bash scripts/manage_tunnel.sh stop
```

주의:
- `*.trycloudflare.com` URL은 시작할 때마다 바뀔 수 있음
- 반드시 `DASHBOARD_TOKEN`을 함께 전달/입력해서 보호

## 10. 24시간 운영
자동 재시작 루프:
```bash
bash scripts/start_bot.sh
```

권장:
- `tmux` 또는 `screen`에서 실행
- 서버 재부팅 후 자동 기동이 필요하면 `launchd`(macOS) 또는 `systemd`(Linux) 서비스로 등록

## 11. Oracle Always Free 배포 (권장)
로컬 PC 대신 Oracle Always Free VM에서 상시 실행하는 방법입니다.

사전 준비:
1. Oracle Cloud 계정 생성
2. Ubuntu VM(Always Free) 1대 생성
3. VM 공인 IP 확인
4. SSH 접속

VM에서 실행:
```bash
# 1) 저장소 클론 (없으면 먼저 GitHub에 코드 업로드)
git clone <YOUR_GITHUB_REPO_URL> /opt/discord-work-bot
cd /opt/discord-work-bot/discord-bot

# 2) 포트 오픈(서버 OS 방화벽)
bash scripts/oracle_free_open_ports.sh

# 3) 설치 + systemd 서비스 등록
bash scripts/oracle_free_install.sh <YOUR_GITHUB_REPO_URL> /opt/discord-work-bot
```

환경변수 입력:
```bash
nano /opt/discord-work-bot/discord-bot/.env
```
필수:
- `DISCORD_TOKEN`
- `DASHBOARD_TOKEN`

서비스 재시작:
```bash
sudo systemctl restart discord-work-bot
sudo systemctl status discord-work-bot --no-pager
sudo journalctl -u discord-work-bot -f
```

대시보드 접속:
- `http://<VM_PUBLIC_IP>:8787`

추가 주의:
- Oracle VCN 보안 규칙에서도 `8787/tcp` 인바운드 허용 필요
- `DISCORD_TOKEN`은 유출 시 즉시 재발급

## 12. 자주 사용하는 명령
- `!help`
- `!ping`
- `!status`
- `/open`
- `/claim`
- `/close`
- `/ticketstatus`
- `/ticketpanel`
- `/manager`

## 13. 문제 해결
- 봇이 안 켜짐
  - `.env`의 `DISCORD_TOKEN` 확인
  - `node index.js` 실행 로그 확인
- 패널 버튼이 반응 없음
  - 봇 권한(`Send Messages`, `Use Application Commands`, `Manage Channels`) 확인
- 특정 사용자만 티켓을 못 봄
  - `!ticket manager list`로 권한 확인
  - 카테고리/채널 권한 상충 여부 확인
- 대시보드 API 401
  - 입력한 토큰과 `DASHBOARD_TOKEN` 일치 여부 확인
- `Used disallowed intents` 오류
  - 우선 `.env`에서 `ENABLE_GUILD_MEMBERS_INTENT=false`, `ENABLE_MESSAGE_CONTENT_INTENT=false`로 실행
  - 해당 기능이 꼭 필요하면 Discord Developer Portal에서 Privileged Intents 활성화 후 `true`로 변경
