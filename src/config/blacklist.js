/**
 * Legal Guard: Trademark and Copyright Blacklist
 * Global markalar, telifli isimler, lisanslı karakterler ve Etsy ban kalkanı.
 */

const TRADEMARK_BLACKLIST = [
  // Eğlence ve Karakter (Disney, Marvel, vb.)
  'disney', 'marvel', 'star wars', 'mickey mouse', 'minnie', 'yoda', 'darth vader',
  'harry potter', 'hogwarts', 'gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff',
  'batman', 'superman', 'wonder woman', 'spider-man', 'spiderman', 'avengers',
  'iron man', 'hulk', 'thor', 'captain america', 'spongebob', 'peppa pig',
  'pokemon', 'pikachu', 'dragon ball', 'naruto', 'one piece', 'hello kitty',

  // Markalar / Giyim
  'nike', 'adidas', 'puma', 'gucci', 'lv', 'louis vuitton', 'chanel', 'prada',
  'dior', 'balenciaga', 'supreme', 'vans', 'converse', 'rolex', 'calvin klein',
  'tommy hilfiger', 'under armour', 'levi', 'levis', 'guess', 'gap',

  // Spor Organizasyonları
  'nba', 'nfl', 'mlb', 'nhl', 'fifa', 'uefa', 'wwe', 'ufc', 'olympic', 'super bowl',
  'lakers', 'bulls', 'yankees', 'dodgers', 'patriots', 'cowboys', 'real madrid',

  // Müzik ve Sanatçılar
  'taylor swift', 'swiftie', 'eras tour', 'beyonce', 'bts', 'blackpink', 'ariana grande',
  'justin bieber', 'drake', 'kanye', 'the beatles', 'rolling stones', 'metallica',
  'nirvana', 'pink floyd', 'michael jackson', 'elvis', 'eminem',

  // Oyunlar
  'minecraft', 'roblox', 'fortnite', 'nintendo', 'playstation', 'xbox', 'mario',
  'zelda', 'call of duty', 'gta', 'league of legends', 'valorant',

  // Sık Ban Yiyen Sloganlar
  'just do it', 'im lovin it', 'let it go', 'may the force', 'hakuna matata',
  'boy scout', 'girl scout', 'harley davidson', 'yellowstone', 'barbie', 'ken',

  // Otomotiv
  'bmw', 'mercedes', 'audi', 'ferrari', 'porsche', 'lamborghini', 'tesla', 'jeep',
  'ford', 'chevrolet', 'toyota', 'honda',

  // Diğer Büyük Popüler Varlıklar
  'lego', 'cocacola', 'coca-cola', 'pepsi', 'red bull', 'monster energy', 'starbucks',
  'iphone', 'apple', 'samsung', 'netflix', 'amazon', 'google', 'facebook', 'instagram'
];

module.exports = { TRADEMARK_BLACKLIST };
