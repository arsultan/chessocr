# ChessOCR

ChessOCR is a full-stack web application designed to digitize handwritten chess scoresheets. It uses AI (OpenAI GPT-4o Vision) to read moves and metadata from scoresheets, validates them using `chess.js`, and generates a standardized PGN which is then stored in a Supabase database.

## Features
- **OCR Processing:** Upload photos or scans of scoresheets (up to 2 pages).
- **AI Recognition:** Uses GPT-4o Vision to extract player names, metadata, and moves.
- **Validation:** Converts Cyrillic piece notation to standard algebraic notation (SAN) and validates each move against `chess.js` rules.
- **Review & Editing:** Interactive board powered by `chessboard.js` to review the game move by move.
- **Database:** Stores digitized games in a Supabase PostgreSQL database for future retrieval.
- **Lichess Integration:** Easy export and direct analysis on Lichess.

## Prerequisites
- Node.js (v18+ recommended)
- Supabase account (for database)
- OpenAI API account (for GPT-4o Vision access)

## Setup Instructions

1. **Install Dependencies**
   \`\`\`bash
   npm install
   \`\`\`

2. **Configure Environment Variables**
   Create a `.env` file in the root directory (you can copy from `.env.example` if it exists) and fill in the required keys:
   \`\`\`env
   OPENAI_API_KEY=your_openai_api_key_here
   OPENAI_MODEL=gpt-4o
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   PORT=3000
   NODE_ENV=development
   \`\`\`

3. **Database Setup (Supabase)**
   Execute the following SQL query in your Supabase SQL Editor to create the `games` table:
   \`\`\`sql
   CREATE TABLE games (
       id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
       white_name TEXT,
       white_fide_id TEXT NOT NULL,
       black_name TEXT,
       black_fide_id TEXT NOT NULL,
       tournament TEXT,
       round TEXT,
       board_number TEXT,
       location TEXT,
       game_date DATE,
       result TEXT,
       pgn TEXT NOT NULL,
       ocr_confidence NUMERIC,
       has_errors BOOLEAN DEFAULT false,
       created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
   );

   CREATE INDEX idx_games_white_fide ON games(white_fide_id);
   CREATE INDEX idx_games_black_fide ON games(black_fide_id);
   CREATE INDEX idx_games_tournament ON games(tournament);
   CREATE INDEX idx_games_date ON games(game_date);
   \`\`\`

4. **Start the Development Server**
   \`\`\`bash
   npm run dev
   \`\`\`
   The server will start at \`http://localhost:3000\`.

## Usage
1. Open \`http://localhost:3000\` in your browser.
2. Drag and drop or take a photo of a chess scoresheet.
3. Click **Распознать бланк**.
4. Review the extracted moves and correct any errors. The board on the right lets you play through the game.
5. Fill in the required `FIDE ID`s.
6. Click **Сохранить в базу данных** to save the PGN and metadata to Supabase.

## Architecture
- **Frontend:** Vanilla HTML/CSS/JS with `chessboard.js` and `chess.js`.
- **Backend:** Express.js + Multer (for file uploads).
- **AI Integration:** OpenAI Node.js SDK.
- **Database:** Supabase PostgreSQL.
