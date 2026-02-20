import { useState, useMemo } from 'react';
import './EmojiPicker.css';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

interface EmojiEntry {
  emoji: string;
  name: string;
}

const CATEGORIES: Record<string, EmojiEntry[]> = {
  'Smileys': [
    { emoji: '\u{1F600}', name: 'grinning' }, { emoji: '\u{1F603}', name: 'smiley' },
    { emoji: '\u{1F604}', name: 'smile' }, { emoji: '\u{1F601}', name: 'grin' },
    { emoji: '\u{1F606}', name: 'laughing' }, { emoji: '\u{1F605}', name: 'sweat_smile' },
    { emoji: '\u{1F602}', name: 'joy' }, { emoji: '\u{1F923}', name: 'rofl' },
    { emoji: '\u{1F62D}', name: 'sob' }, { emoji: '\u{1F60A}', name: 'blush' },
    { emoji: '\u{1F607}', name: 'innocent' }, { emoji: '\u{1F60D}', name: 'heart_eyes' },
    { emoji: '\u{1F618}', name: 'kissing_heart' }, { emoji: '\u{1F61C}', name: 'stuck_out_tongue_winking_eye' },
    { emoji: '\u{1F92A}', name: 'zany_face' }, { emoji: '\u{1F928}', name: 'face_with_raised_eyebrow' },
    { emoji: '\u{1F914}', name: 'thinking' }, { emoji: '\u{1F910}', name: 'zipper_mouth' },
    { emoji: '\u{1F644}', name: 'rolling_eyes' }, { emoji: '\u{1F612}', name: 'unamused' },
    { emoji: '\u{1F624}', name: 'triumph' }, { emoji: '\u{1F620}', name: 'angry' },
    { emoji: '\u{1F621}', name: 'rage' }, { emoji: '\u{1F92C}', name: 'cursing' },
    { emoji: '\u{1F622}', name: 'cry' }, { emoji: '\u{1F625}', name: 'disappointed_relieved' },
    { emoji: '\u{1F631}', name: 'scream' }, { emoji: '\u{1F633}', name: 'flushed' },
    { emoji: '\u{1F97A}', name: 'pleading' }, { emoji: '\u{1F60E}', name: 'sunglasses' },
    { emoji: '\u{1F913}', name: 'nerd' }, { emoji: '\u{1F974}', name: 'woozy' },
    { emoji: '\u{1F971}', name: 'yawning' }, { emoji: '\u{1F634}', name: 'sleeping' },
    { emoji: '\u{1F4A9}', name: 'poop' }, { emoji: '\u{1F47B}', name: 'ghost' },
    { emoji: '\u{1F480}', name: 'skull' }, { emoji: '\u{1F916}', name: 'robot' },
  ],
  'Gestures': [
    { emoji: '\u{1F44D}', name: 'thumbsup' }, { emoji: '\u{1F44E}', name: 'thumbsdown' },
    { emoji: '\u{1F44F}', name: 'clap' }, { emoji: '\u{1F64C}', name: 'raised_hands' },
    { emoji: '\u{1F64F}', name: 'pray' }, { emoji: '\u{1F91D}', name: 'handshake' },
    { emoji: '\u{270C}\u{FE0F}', name: 'v' }, { emoji: '\u{1F918}', name: 'metal' },
    { emoji: '\u{1F44B}', name: 'wave' }, { emoji: '\u{1F4AA}', name: 'muscle' },
    { emoji: '\u{1F448}', name: 'point_left' }, { emoji: '\u{1F449}', name: 'point_right' },
    { emoji: '\u{1F446}', name: 'point_up' }, { emoji: '\u{1F447}', name: 'point_down' },
    { emoji: '\u{270B}', name: 'hand' }, { emoji: '\u{1F596}', name: 'vulcan' },
    { emoji: '\u{1F595}', name: 'middle_finger' },
  ],
  'Hearts': [
    { emoji: '\u{2764}\u{FE0F}', name: 'heart' }, { emoji: '\u{1F9E1}', name: 'orange_heart' },
    { emoji: '\u{1F49B}', name: 'yellow_heart' }, { emoji: '\u{1F49A}', name: 'green_heart' },
    { emoji: '\u{1F499}', name: 'blue_heart' }, { emoji: '\u{1F49C}', name: 'purple_heart' },
    { emoji: '\u{1F5A4}', name: 'black_heart' }, { emoji: '\u{1F494}', name: 'broken_heart' },
    { emoji: '\u{1F495}', name: 'two_hearts' }, { emoji: '\u{1F496}', name: 'sparkling_heart' },
    { emoji: '\u{1F48B}', name: 'kiss' }, { emoji: '\u{1F49D}', name: 'gift_heart' },
  ],
  'Objects': [
    { emoji: '\u{1F389}', name: 'tada' }, { emoji: '\u{1F388}', name: 'balloon' },
    { emoji: '\u{1F381}', name: 'gift' }, { emoji: '\u{1F3AE}', name: 'video_game' },
    { emoji: '\u{1F3B5}', name: 'musical_note' }, { emoji: '\u{1F3B6}', name: 'notes' },
    { emoji: '\u{1F525}', name: 'fire' }, { emoji: '\u{2728}', name: 'sparkles' },
    { emoji: '\u{1F4A5}', name: 'boom' }, { emoji: '\u{1F4AF}', name: '100' },
    { emoji: '\u{1F440}', name: 'eyes' }, { emoji: '\u{1F4A4}', name: 'zzz' },
    { emoji: '\u{2705}', name: 'white_check_mark' }, { emoji: '\u{274C}', name: 'x' },
    { emoji: '\u{2757}', name: 'exclamation' }, { emoji: '\u{2753}', name: 'question' },
    { emoji: '\u{1F4A1}', name: 'bulb' }, { emoji: '\u{1F680}', name: 'rocket' },
    { emoji: '\u{2B50}', name: 'star' }, { emoji: '\u{1F31F}', name: 'star2' },
    { emoji: '\u{1F4BB}', name: 'computer' }, { emoji: '\u{1F4F1}', name: 'iphone' },
    { emoji: '\u{2615}', name: 'coffee' }, { emoji: '\u{1F37A}', name: 'beer' },
    { emoji: '\u{1F37B}', name: 'beers' }, { emoji: '\u{1F355}', name: 'pizza' },
  ],
  'Animals': [
    { emoji: '\u{1F436}', name: 'dog' }, { emoji: '\u{1F431}', name: 'cat' },
    { emoji: '\u{1F42D}', name: 'mouse' }, { emoji: '\u{1F439}', name: 'hamster' },
    { emoji: '\u{1F430}', name: 'rabbit' }, { emoji: '\u{1F43B}', name: 'bear' },
    { emoji: '\u{1F43C}', name: 'panda' }, { emoji: '\u{1F984}', name: 'unicorn' },
    { emoji: '\u{1F40D}', name: 'snake' }, { emoji: '\u{1F419}', name: 'octopus' },
    { emoji: '\u{1F422}', name: 'turtle' }, { emoji: '\u{1F41D}', name: 'bee' },
  ],
};

// Build a name->emoji lookup for shortcode support
const SHORTCODE_MAP = new Map<string, string>();
for (const entries of Object.values(CATEGORIES)) {
  for (const e of entries) {
    SHORTCODE_MAP.set(e.name, e.emoji);
  }
}

export { SHORTCODE_MAP };

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('Smileys');
  const categoryNames = Object.keys(CATEGORIES);

  const filtered = useMemo(() => {
    if (!search) return CATEGORIES[activeCategory] || [];
    const q = search.toLowerCase();
    const results: EmojiEntry[] = [];
    for (const entries of Object.values(CATEGORIES)) {
      for (const e of entries) {
        if (e.name.includes(q)) results.push(e);
      }
    }
    return results;
  }, [search, activeCategory]);

  return (
    <div className="emoji-picker" onClick={(e) => e.stopPropagation()}>
      <div className="emoji-picker-header">
        <input
          className="emoji-search"
          type="text"
          placeholder="Search emoji..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <button className="emoji-picker-close" onClick={onClose}>&times;</button>
      </div>
      {!search && (
        <div className="emoji-categories">
          {categoryNames.map((cat) => (
            <button
              key={cat}
              className={`emoji-cat-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}
      <div className="emoji-grid">
        {filtered.map((e) => (
          <button
            key={e.name}
            className="emoji-grid-btn"
            title={`:${e.name}:`}
            onClick={() => onSelect(e.emoji)}
          >
            {e.emoji}
          </button>
        ))}
        {filtered.length === 0 && (
          <span className="emoji-no-results">No emoji found</span>
        )}
      </div>
    </div>
  );
}
