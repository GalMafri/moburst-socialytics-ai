# Who uses the Socialytics API

One key per consumer, so each can be revoked on its own and `api_requests` shows who called what. No secrets here: keys are shown once when created and live only with their owner.

| Consumer | Contact | How it connects | Scopes | Status |
|---|---|---|---|---|
| moburst.ai portal, admin costs page | Portal owner | API key | `costs` | To issue when the costs integration starts |
| Fernando's demo screen (gOS) | Fernando Ideses | API key | `demo`, `read` | Existing key |
| AgentBurst | Eyal | API key, REST (MCP once it exists) | `read`, `run` | To issue; `run` routes are being added |
| Mobi | AI team | API key over MCP | `read` | To issue with the Mobi MCP work |
| Moburst staff in Claude | each person | Claude connector | their own permissions | Signs in per person with OAuth; no key. |
| Moburst staff scripts and tools | each person | personal key | `read` (`run` when added) | Self-service |

When you issue or revoke a key, update this table in the same change.
