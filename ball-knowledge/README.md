# Ball Knowledge

Front Three style football party games in one online app. Make a room, share the 4 letter code, everyone plays on their own phone.

## Games

| Game | Players | How it works |
|---|---|---|
| 🕵️ Football Imposter | 3 to 10 | Everyone gets the same secret player except the imposter. Take turns giving clues, then vote. If the imposter is caught they get one guess at the player to steal points. |
| 💰 Investment Game | 1 to 10 | Ballionaire style. You land in a random summer between 2010 and 2019 with a budget. Buy players at their real Transfermarkt value, then the clock jumps forward. Richest at the final cash out wins. Optional blind cards. |
| 🚢 Football Battleship | 1 to 10 | 5x5 grid of clubs and nations with a hidden fleet. To fire at a square, name a player who played for that club and is from that nation. Every player can only be used once. |
| 🔤 Alphabet Challenge | 1 to 10 | A to Z in turns for a category (Premier League, Brazilians, played for Chelsea, etc). Surname must start with the letter. Three lives. |
| ❓ Who Am I? | 1 to 10 | Six clues drop one at a time. Guess early for more points. |
| 🟦 Football Jeopardy | 1 to 10 | Categories by value, buzzer race, wrong answers cost points, one hidden Daily Double. |
| 🏃 The Chase | 1 to 9 | Cash builder, high or low offer, head to head on the ladder vs a bot Chaser (easy, medium, hard) or one of you, then the final chase. |
| 🐍 Trivia Path | 1 to 8 | Snakes and ladders. Roll, land, answer. Ladders need a hard question to climb, snakes need one to dodge. |

Points from every game add up on the lobby leaderboard for the whole session.

## The data

`players.json` has 12,759 real players (big names and loads of deep cuts) built from the Transfermarkt datalake at github.com/salimt/football-datasets. It's a snapshot from September 2025, so clubs and values are as of the start of the 2025/26 season.

Each player has: nationality and caps, position, foot, height, birthplace, every senior club with apps and goals, league and Champions League totals, best league season, peak value, value history (used by the Investment Game), plus 9,000+ transfer fees. All questions are worked out straight from this data, so the answers are always checkable.

Stats count senior club games in all competitions (youth and B teams are left out).

## Run it locally

```
npm install
npm start
```

Open http://localhost:3000

## Deploy on Render (same as Going Once)

1. Make a new GitHub repo and upload every file in this folder (no subfolders, so just drag them all in). `players.json` is about 18MB which is fine for GitHub's web upload.
2. On Render: New, Web Service, connect the repo.
3. Build command: `npm install`
4. Start command: `npm start`
5. Instance type: Free is fine.

Then share the Render link. People can also join straight from an invite link like `yoursite.onrender.com/?room=ABCD`.

## Files

* `server.js` rooms, lobby, reconnects, timers
* `data.js` loads the players, fuzzy name matching (accents, surnames, small typos)
* `questions.js` the question generator shared by Jeopardy, The Chase and Trivia Path
* `mode_*.js` one file per game
* `index.html`, `client.js`, `style.css` the frontend
