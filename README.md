# Discord Reader

디스코드 **봇 토큰**으로 서버의 채널·스레드 메시지를 읽어 AI 도구로 제공합니다. 대화 요약, 회의 내용 정리, 피드백 수집에 씁니다. (읽기 전용 — 메시지를 보내지 않습니다.)

## 준비
1. [Discord Developer Portal](https://discord.com/developers/applications)에서 앱 → **Bot**을 만들고 토큰을 복사합니다.
2. Bot 설정에서 **Message Content Intent**를 켭니다(꺼져 있으면 본문이 비어 옵니다).
3. OAuth2 URL로 봇을 서버에 초대합니다(권한: View Channels, Read Message History).
4. 설정 → 플러그인 → Discord Reader에 **봇 토큰**(필수), **기본 서버 ID**(선택), **최대 메시지 수**(기본 1000)를 넣습니다.

## AI 도구
| 도구 | 하는 일 |
|---|---|
| `discord_list_guilds` | 봇이 들어가 있는 서버 목록과 ID |
| `discord_list_channels` | 채널·활성 스레드 목록 (guildId 생략 시 기본 서버) |
| `discord_read_messages` | 채널/스레드 메시지를 시간순 텍스트로. `after`/`before`에 메시지 ID나 ISO 날짜 |

## 예
- "디스코드 먹봇 채널 오늘 대화 요약해줘"
- "#피드백 채널에서 지난주 버그 제보만 정리해줘"

> 토큰은 이 PC의 앱 설정에만 저장되고 플러그인 파일에는 들어가지 않습니다.
