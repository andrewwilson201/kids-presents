# Makes data/ideas.json, the starter present ideas: python3 tools/make-ideas.py data/ideas.json
import json, re, sys
# name | £ | ages | for | category | interests | description | search
rows = r"""
LEGO City small vehicle set|10|5-9|any|Building|lego, building, vehicles, police, fire engines|A small City set (police car, fire truck, digger). Quick to build, plays well after.|LEGO City small set
LEGO Friends small set|10|5-9|any|Building|lego, building, animals, friends|A small Friends set: café, vet, pony stable.|LEGO Friends small set
LEGO Minecraft small set|12|7-11|any|Building|lego, minecraft, gaming|A small Minecraft biome set; popular with gamers.|LEGO Minecraft small set
LEGO Classic creative brick box|15|4-10|any|Building|lego, building, creative|Loose bricks with ideas booklet; goes with any LEGO collection.|LEGO Classic creative bricks box
LEGO Ninjago small set|12|6-10|any|Building|lego, ninjago, ninjas, dragons|A small Ninjago set with a minifigure or two.|LEGO Ninjago small set
LEGO Disney Princess mini set|10|5-9|any|Building|lego, disney, princesses, frozen|A small Disney build (Frozen, Encanto, princess scenes).|LEGO Disney mini set
LEGO Dreamzzz small set|12|7-10|any|Building|lego, building, fantasy, creatures|Dream-creature builds that can be made two ways.|LEGO Dreamzzz set
Magna-Tiles or magnetic tiles starter set|20|3-8|any|Building|building, magnets, construction, stem|Translucent magnetic tiles; lots of creative play.|magnetic tiles 32 piece set
Marble run starter set|15|5-10|any|Building|building, marbles, stem, engineering|Build-it-yourself marble run with plenty of pieces.|marble run construction set kids
Plus-Plus tube|12|5-12|any|Building|building, creative, fine motor|Interlocking puzzle pieces for 2D and 3D builds.|Plus-Plus tube
Squishmallow 8 inch|12|3-12|any|Soft toys|squishmallows, cuddly toys, collecting|The collectable squishy soft toys. A safe bet for most children.|Squishmallows 8 inch
Jellycat small soft toy|20|3-10|any|Soft toys|cuddly toys, animals|A small Jellycat (bunny, dragon, octopus). Lovely quality.|Jellycat small
Pokémon booster pack bundle|12|6-12|any|Collecting|pokemon, cards, collecting, trading cards|Two or three Pokémon TCG boosters or a mini tin.|Pokemon mini tin
Pokémon cuddly toy|15|4-10|any|Soft toys|pokemon, cuddly toys|Pikachu, Eevee or a starter Pokémon plush.|Pokemon plush 8 inch
Match Attax / football sticker starter pack|10|6-12|any|Collecting|football, collecting, cards, stickers|Football trading cards starter pack with binder.|Match Attax starter pack
Panini sticker album and stickers|10|6-12|any|Collecting|football, stickers, collecting|Sticker album with a few packets to get started.|Panini sticker album starter pack
Football (size 4) with pump|12|5-12|any|Sport|football, sport, outdoors|A proper size 4 ball. Club colours make it special.|size 4 football kids
Mini football goal set|20|4-10|any|Sport|football, sport, outdoors, garden|Pop-up goals for the garden or park.|pop up football goals kids
Swingball / tennis ball set|20|5-12|any|Sport|tennis, garden, outdoors, sport|All-surface swingball for the garden.|all surface swingball
Skipping rope and chalk set|8|5-10|any|Outdoors|outdoors, playground, active|Wooden-handle skipping rope with chunky pavement chalk.|kids skipping rope pavement chalk set
Frisbee / flying disc set|10|6-12|any|Outdoors|outdoors, sport, beach, park|Soft flying disc or Aerobie ring for the park.|Aerobie flying ring
Kite for kids|12|5-12|any|Outdoors|outdoors, kites, wind, park|Easy-flying single-line kite.|easy fly kite for kids
Bug hunting kit|12|4-9|any|Nature|nature, bugs, insects, science, outdoors|Bug viewer, net and magnifier for garden explorers.|bug hunting kit kids
Grow your own kit|8|4-10|any|Nature|gardening, nature, plants, science|Sunflower, cress or pizza garden grow kit.|kids grow your own kit
Rock painting kit|12|5-10|any|Arts & crafts|art, painting, crafts, rocks|Stones, paints and sealant for painted pebbles.|rock painting kit kids
Hama / perler beads set|10|5-11|any|Arts & crafts|crafts, beads, art, minecraft, pokemon|Iron-on beads with pegboards and patterns.|Hama beads set
Make your own slime kit|12|6-12|any|Science|slime, science, messy play, crafts|Glitter or glow slime making kit.|make your own slime kit
Crystal growing kit|12|8-12|any|Science|science, crystals, stem, experiments|Grow crystals in a few days. Works best 8+.|crystal growing kit kids
Volcano / fizzy science kit|12|6-11|any|Science|science, experiments, stem, volcanoes|Erupting volcano or fizzy reactions kit.|kids volcano science kit
Dig-it-out dinosaur fossil kit|8|5-10|any|Science|dinosaurs, fossils, digging, science|Chisel a dinosaur skeleton out of a plaster block.|dinosaur excavation kit
Dinosaur figures set|12|3-8|any|Toys|dinosaurs, animals|A tub of realistic dinosaur figures.|realistic dinosaur figures set
Schleich animal or dinosaur figure|10|4-10|any|Toys|animals, horses, dinosaurs, farm|A detailed Schleich figure (horse, dino, wild animal).|Schleich figure
Hot Wheels track set|15|4-9|any|Toys|cars, racing, vehicles, hot wheels|A track set with a car or two; loops and jumps.|Hot Wheels track set
Hot Wheels 5 car pack|7|3-9|any|Toys|cars, vehicles, hot wheels, racing|Five die-cast cars. Cheap and always welcome.|Hot Wheels 5 pack
Remote control car|20|5-10|any|Toys|cars, remote control, racing, vehicles|Small RC stunt car with rechargeable battery.|kids remote control stunt car
Nerf blaster (small)|15|8-12|any|Toys|nerf, active, outdoors|A small Nerf Elite blaster with darts. Check the parents are OK with it.|Nerf Elite small blaster
Water pistols pair|8|4-10|any|Outdoors|outdoors, water, summer|Two water blasters for summer parties.|kids water blaster pair
Paw Patrol vehicle with figure|12|3-6|any|Toys|paw patrol, vehicles, dogs|A pup and their vehicle.|Paw Patrol vehicle figure
Bluey figure set|12|3-7|any|Toys|bluey, figures, tv|Bluey and family figures or a playset.|Bluey figure pack
Peppa Pig playset|12|3-5|any|Toys|peppa pig, tv, pretend play|Small Peppa playset or figure pack.|Peppa Pig playset
Barbie doll with outfit|15|4-9|girl|Dolls|barbie, dolls, fashion|A Barbie with accessories.|Barbie doll
Polly Pocket compact|12|4-8|girl|Dolls|polly pocket, dolls, collecting|Tiny world in a compact. Small pieces.|Polly Pocket compact
Sylvanian Families figure set|15|4-9|any|Dolls|sylvanian families, animals, pretend play|A Sylvanian family or baby set.|Sylvanian Families family set
Gabby's Dollhouse figure pack|12|3-7|any|Toys|gabby's dollhouse, cats, tv|Gabby and cat figures.|Gabby's Dollhouse figure pack
Frozen doll or accessory|15|3-8|girl|Dolls|frozen, disney, princesses, dolls|Elsa or Anna doll, or dress-up accessories.|Disney Frozen Elsa doll
Dress-up costume|15|3-8|any|Dress-up|dress up, pretend play, superheroes, princesses|A costume in their favourite character.|kids dress up costume
Superhero figure|12|4-9|any|Toys|superheroes, marvel, spiderman, batman|Spider-Man, Batman or Avengers action figure.|Marvel action figure 6 inch
Make your own jewellery kit|10|5-10|any|Arts & crafts|jewellery, crafts, beads, fashion|Bead bracelets or charm necklace kit.|kids bead bracelet making kit
Friendship bracelet maker|12|7-12|any|Arts & crafts|crafts, friendship bracelets, fashion|Loom or bracelet kit with threads.|friendship bracelet kit
Scratch art pad set|8|4-10|any|Arts & crafts|art, drawing, crafts|Rainbow scratch-off sheets with stylus.|rainbow scratch art set
Sticker activity book bumper pack|8|4-8|any|Books & activities|stickers, activity books|Reusable or bumper sticker activity book.|sticker activity book kids
Colouring set with felt tips|12|4-10|any|Arts & crafts|art, colouring, drawing|Case of felt tips, crayons and pencils.|kids art set case
Window / suncatcher paint kit|10|4-8|any|Arts & crafts|art, painting, crafts|Paint your own suncatchers.|suncatcher painting kit
Paint your own unicorn / figure|10|4-9|any|Arts & crafts|unicorns, painting, crafts|Paint a plaster or ceramic figure.|paint your own unicorn
Unicorn soft toy or gift set|12|3-8|girl|Soft toys|unicorns, rainbows, cuddly toys|Unicorn plush or unicorn activity box.|unicorn gift kids
Spirograph set|12|6-12|any|Arts & crafts|art, drawing, patterns|Classic design kit.|Spirograph design set
Air-dry clay modelling kit|12|5-11|any|Arts & crafts|clay, modelling, crafts|Clay and tools to make animals or keepsakes.|air dry clay kit kids
Play-Doh bumper pack|10|3-7|any|Arts & crafts|play-doh, modelling, messy play|Tubs of Play-Doh with cutters.|Play-Doh 10 pack
Kinetic sand set|12|3-8|any|Sensory|sand, sensory, messy play|Kinetic sand with moulds in a tray.|Kinetic Sand set
Fidget toy bundle|8|5-12|any|Sensory|fidget toys, sensory|Pop-its, squishies and a fidget spinner.|fidget toys pack kids
Squishy / Needoh stress ball|6|5-12|any|Sensory|squishies, fidget toys, sensory|The very popular squishy stress balls.|Nee Doh stress ball
Torch / head torch|10|5-12|any|Outdoors|camping, outdoors, adventure, torch|Kids head torch for camping and dens.|kids head torch
Walkie-talkies pair|18|5-12|any|Gadgets|gadgets, spy, outdoors|Two-way radios for the garden or park.|kids walkie talkies
Spy kit|12|6-11|any|Toys|spy, detective, mystery|Invisible ink pen, fingerprint kit, spy glasses.|kids spy kit
Magic tricks set|15|6-12|any|Toys|magic, tricks, performing|Beginner magic kit with instructions.|kids magic set
Yo-yo or kendama|8|7-12|any|Toys|skill toys, tricks|A good beginner yo-yo.|beginner yo-yo kids
Bubble machine or giant bubble wand|10|3-8|any|Outdoors|bubbles, outdoors, garden|Bubble gun or giant wand kit.|kids bubble machine
Uno / Uno Junior|8|5-12|any|Games|card games, games, family|The card game every family plays.|Uno card game
Dobble|10|6-12|any|Games|card games, games, family, quick|Fast spot-the-match game, small and portable.|Dobble card game
Guess Who|15|6-10|any|Games|board games, games, family|Classic two-player guessing game.|Guess Who game
Pop-up Pirate|12|4-8|any|Games|games, pirates, family|The barrel game with the jumping pirate.|Pop Up Pirate game
Hungry Hippos or Operation|15|4-8|any|Games|board games, games, family|Classic noisy family game.|Hungry Hippos game
Exploding Kittens (kids version)|15|7-12|any|Games|card games, games, cats, family|The kids edition of the card game.|Exploding Kittens kids edition
Jigsaw puzzle (100–200 pieces)|10|5-10|any|Puzzles|puzzles, jigsaw|A jigsaw on a theme they love.|kids jigsaw 100 piece
Rubik's Cube or speed cube|8|7-12|any|Puzzles|puzzles, brain teasers, skill toys|A smooth speed cube.|speed cube 3x3
Logic puzzle game (Smart Games)|15|5-10|any|Puzzles|puzzles, logic, stem, games|Single-player logic puzzle with challenge cards.|Smart Games puzzle
Top Trumps pack|5|6-12|any|Games|card games, facts, football, animals, collecting|Pocket-sized; dozens of themes.|Top Trumps cards
Book: David Walliams or Roald Dahl|8|6-11|any|Books|books, reading, funny stories|A funny chapter book.|Roald Dahl book
Book: Dog Man or Cat Kid comic|8|6-11|any|Books|books, comics, reading, funny stories|Graphic novels reluctant readers love.|Dog Man book
Book: Julia Donaldson picture book|7|3-6|any|Books|books, reading, picture books|The Gruffalo, Room on the Broom and friends.|Julia Donaldson book
Book: Rainbow Magic or Isadora Moon|6|5-9|any|Books|books, reading, fairies, magic|Early chapter books with series to collect.|Isadora Moon book
Book: Diary of a Wimpy Kid|8|8-12|any|Books|books, reading, funny stories|Big series, great for 8+.|Diary of a Wimpy Kid book
Book: Guinness World Records or fact book|12|7-12|any|Books|books, facts, animals, space|Big fact book to pore over.|Guinness World Records book
Book: Minecraft or Pokémon guide|10|6-12|any|Books|books, minecraft, pokemon, gaming|Official handbook for fans.|Pokemon handbook
Space projector torch or planets kit|12|5-10|any|Science|space, planets, science, stars|Star projector or glow-in-the-dark solar system.|glow in the dark solar system kit
Telescope (beginner)|25|7-12|any|Science|space, stars, science, astronomy|Simple kids telescope for the moon.|kids beginner telescope
Magnifying glass and microscope set|15|6-11|any|Science|science, nature, microscope|Pocket microscope or explorer set.|kids pocket microscope
Coding robot or Code & Go mouse|25|5-9|any|Science|coding, robots, stem, technology|Screen-free coding toy.|coding robot mouse kids
Reusable water bottle with name|10|4-12|any|Personalised|personalised, school, practical|Personalised bottle in their favourite colours.|personalised kids water bottle
Personalised name book or puzzle|15|3-8|any|Personalised|personalised, books, puzzles|Order a few days ahead.|personalised kids name puzzle
Hair accessories set|8|4-10|girl|Fashion|hair, fashion, accessories|Scrunchies, clips and bands in a gift box.|kids hair accessories set
Nail art / makeup-free beauty kit|10|6-11|girl|Fashion|nail art, fashion, beauty, pamper|Peel-off nail polish and stickers.|kids peel off nail polish set
Diary with lock|10|6-11|any|Stationery|stationery, writing, secrets|Secret diary with key or code lock.|kids lockable diary
Gel pen set|8|6-12|any|Stationery|stationery, drawing, writing, art|Glitter and neon gel pens.|gel pen set kids
Pencil case filled with stationery|10|5-11|any|Stationery|stationery, school|Novelty pencil case with bits inside.|filled pencil case kids
Stretch Armstrong or squishy figure|12|5-10|any|Toys|squishies, superheroes|Stretchy, squishy action figure.|Stretch Armstrong mini
Tamagotchi or virtual pet|20|7-12|any|Gadgets|virtual pets, gadgets, collecting|The retro digital pet is back in fashion.|Tamagotchi
Kids digital camera|25|5-10|any|Gadgets|cameras, photography, gadgets|Simple kids camera.|kids digital camera
Karaoke microphone (Bluetooth)|15|5-12|any|Gadgets|music, singing, karaoke|Wireless mic with speaker and lights.|kids karaoke microphone bluetooth
Musical instrument (ukulele, kazoo set)|20|5-12|any|Music|music, instruments, singing|Beginner ukulele or a fun kazoo/harmonica set.|kids ukulele
Disco ball light or night light|10|4-10|any|Bedroom|bedroom, lights, music, disco|Colour-changing night light or mini disco ball.|kids colour changing night light
Football club kit item|20|5-12|any|Sport|football, sport, club|Club socks, scarf or hat. Check which team!|kids football scarf
Swim goggles and dive toys|10|5-10|any|Sport|swimming, water, summer|Fun goggles with dive rings or sticks.|kids swimming goggles dive toys
Scooter accessories (lights, bell)|10|4-9|any|Outdoors|scooters, bikes, outdoors|Light-up wheels, streamers, bell or bag.|scooter light up accessories
Cookie or cupcake baking kit|12|5-11|any|Cooking|baking, cooking, cakes|Kids baking set with cutters and recipes.|kids baking set
Gift card (book or toy shop)|10|5-12|any|Gift cards|books, any|When you're stuck. Waterstones, Smyths or similar.|Waterstones gift card
Experience voucher (cinema, soft play)|15|4-12|any|Gift cards|experiences, cinema, days out|Two cinema or soft-play tickets in a card.|kids cinema gift card
Craft box (pom-poms, pipe cleaners, googly eyes)|10|4-9|any|Arts & crafts|crafts, art, making|Big box of craft bits for making anything.|kids craft box bumper
Gem art / diamond painting kit|10|6-12|any|Arts & crafts|crafts, art, sparkles, gems|Sparkly stick-on gem pictures.|kids diamond painting kit
Mini Brands or blind-bag collectables|8|5-11|any|Collecting|collecting, surprise, blind bags|Surprise collectable capsules.|Mini Brands capsule
Pencil sharpener / desk gadget novelty|6|5-10|any|Stationery|stationery, school, funny|Something silly for the pencil case.|novelty pencil sharpener
Glow sticks and party bag fillers mega pack|6|4-10|any|Toys|glow sticks, party|A cheap add-on for a joint present.|glow sticks pack
Card game: Sleeping Queens|12|6-10|any|Games|card games, games, queens, family|Clever, short card game invented by a 6-year-old.|Sleeping Queens card game
Horse riding / pony gift set|15|5-11|girl|Toys|horses, ponies, animals|Pony figure with grooming set.|kids horse grooming set toy
Racing track car set (Scalextric junior)|25|5-10|any|Toys|cars, racing, motor racing|Small battery race set.|Micro Scalextric
Minecraft figures or plush|12|6-11|any|Toys|minecraft, gaming|Creeper plush or figure pack.|Minecraft plush
Sonic or Mario figure|12|5-11|any|Toys|mario, sonic, gaming, nintendo|Nintendo / Sonic figures or plush.|Super Mario figure
Roblox toy or gift card|12|7-12|any|Gaming|roblox, gaming|Roblox figure, or a gift card if parents allow.|Roblox gift card
"""
out=[]; seen=set()
for line in rows.strip().split('\n'):
    name,price,ages,for_,cat,ints,desc,search=line.split('|')
    a,b=ages.split('-')
    i=re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')[:40]
    assert i not in seen, i; seen.add(i)
    out.append({'id':'s-'+i,'name':name,'description':desc,'price':float(price) if '.' in price else int(price),'ageMin':int(a),'ageMax':int(b),'for':for_,'category':cat,'interests':[x.strip() for x in ints.split(',')],'search':search})
json.dump(out,open(sys.argv[1],'w'),indent=1,ensure_ascii=False)
print(len(out))
