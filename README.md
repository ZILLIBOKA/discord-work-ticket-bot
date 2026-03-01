# Discord Work Ticket Bot

업무용 티켓 처리용 Discord Bot + Dashboard입니다.

## 1. 현재 기능
- `/open` 모달 티켓 생성
  - `Job Ticket`: Date, TS(Trainset), Location(Car/Part), Fault
  - `Material Use Ticket`: Date, Job No, Material with S/N
  - `Defected Material Ticket`: Date, Job No, Defected Material with S/N
  - `Asset/Material Request Ticket`: Date, Requested Asset/Material, Quantity, Request Details
  - `General Ticket`: Date, Inquiry Details
- 티켓 채널 생성 / Close
- Ticket Live / Ticket History 조회
- Dashboard 탭 구조
  - `Overview`: 사용자/역할 목록, Live, History
  - `Operations`: 티켓 번호 재정렬
  - `Master`: 임베드 공지 전송 + Operations 권한 설정
- Discord OAuth 로그인 연동
  - QR 로그인 지원 (스캔 후 원래 대시보드 화면에서 자동 로그인 완료)
- Master 접근 제한: Technical Lead 계정만 허용

## 2. 필수 준비
### 2.1 Discord Bot
1. [Discord Developer Portal](https://discord.com/developers/applications)에서 앱 생성
2. `Bot` 탭에서 토큰 발급
3. 봇을 서버에 초대

### 2.2 Discord OAuth2 (Dashboard 로그인용)
1. 같은 앱의 `OAuth2` 설정으로 이동
2. Redirect URI 추가
- `https://<KOYEB_DOMAIN>/auth/discord/callback`
3. OAuth Scope: `identify`

## 3. 환경변수
`.env` 또는 Koyeb Environment Variables에 아래 값을 설정합니다.

```env
DISCORD_TOKEN=...
DASHBOARD_TOKEN=...

# 저장소 선택
STORAGE_BACKEND=supabase

# local 저장(선택)
BOT_DATA_PATH=./data/bot-data.json

# supabase 저장(권장: 무료 플랜에서도 재배포 후 유지)
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
SUPABASE_TABLE=bot_state
SUPABASE_ROW_ID=global

# Discord OAuth2
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://<KOYEB_DOMAIN>/auth/discord/callback

# Master 허용 역할 (둘 중 하나로 매칭)
TECHNICAL_LEAD_ROLE_ID=
TECHNICAL_LEAD_ROLE_NAME=Technical Lead

DASHBOARD_PORT=8787
SLASH_GUILD_ID=
ENABLE_GUILD_MEMBERS_INTENT=false
ENABLE_MESSAGE_CONTENT_INTENT=false
```

### 변수 설명
- `DISCORD_TOKEN`: 봇 로그인 토큰
- `DASHBOARD_TOKEN`: 일반 Dashboard API 토큰
- `STORAGE_BACKEND`: `local` 또는 `supabase`
- `BOT_DATA_PATH`: local 모드 저장 파일 경로
- `SUPABASE_*`: supabase 모드 저장소 설정
- `DISCORD_CLIENT_ID/SECRET/REDIRECT_URI`: OAuth 로그인용
- `TECHNICAL_LEAD_ROLE_ID`: Master 탭 접근 허용 역할 ID(권장)
- `TECHNICAL_LEAD_ROLE_NAME`: Master 탭 접근 허용 역할명(기본: `Technical Lead`)

## 4. 로컬 실행
```bash
cd "/Users/sunghyunhwang/Documents/New project/discord-bot"
npm install
node index.js
```

- Dashboard: `http://localhost:8787`

## 5. Koyeb 배포 기준 순서
1. GitHub 최신 `main` 배포
2. Koyeb Service Environment Variables 설정
3. Supabase에서 아래 SQL 실행 후 테이블 생성
```sql
create table if not exists public.bot_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb
);
```
4. 서비스 환경변수 설정
- `STORAGE_BACKEND=supabase`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_TABLE=bot_state`
- `SUPABASE_ROW_ID=global`
5. `DISCORD_REDIRECT_URI`가 실제 Koyeb 도메인과 정확히 일치하는지 확인
6. Deploy
7. Dashboard 접속 후
- `DASHBOARD_TOKEN` 저장(비 OAuth 백업 모드에서만 사용)
- `Discord Login` 수행
- (로그인 계정이 해당 길드에서 Technical Lead 역할이면) `Master` 탭 접근 가능

## 6. 탭별 사용법
### 6.1 Overview
- 사용자 목록(역할 기준 정렬) 확인
- 역할 목록 확인
- Ticket Live 확인
- Ticket History 확인/검색

### 6.2 Operations
- Ticket Number Maintenance
  - Ticket History에서 체크박스로 잘못 생성된 번호 선택
  - 제거 후 전체 번호 재정렬
- Operations 권한 계정/역할만 실행 가능

### 6.3 Master
- 임베드 공지 전송
- 삭제 티켓 복구 (Operations에서 제거한 티켓 복원)
- 길드별 Operations 사용자/역할 추가/제거
- Master 접근 조건
  1. Discord 로그인
  2. 로그인 계정이 해당 길드의 `Technical Lead` 역할 보유

## 7. Discord 명령
- `/open`
- `/close`
- `/ticketstatus`
- `/ticketpanel`

## 8. 문제 해결
- Master 탭이 안 열림
  - 로그인 계정에 `Technical Lead` 역할이 있는지 확인
  - `TECHNICAL_LEAD_ROLE_ID` 또는 `TECHNICAL_LEAD_ROLE_NAME` 설정 확인
- OAuth 로그인 버튼이 안 보임
  - `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` 확인
- OAuth 콜백 실패
  - Developer Portal Redirect URI와 `DISCORD_REDIRECT_URI` 완전 일치 필요
- Operations 실행 실패(403)
  - Master 탭에서 해당 사용자/역할을 Operations 권한에 추가
