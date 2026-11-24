# Jeu de Poker

Jeu d'entraînement au poker contre des bots : Texas Hold'em (No Limit, Pot Limit, Limit), cash game et tournoi. Omaha et 2-7 Triple Draw prévus ensuite.

- `src/engine` : moteur de règles indépendant de l'affichage (cartes, évaluation des mains, déroulement d'une main, bots).
- `src/ui`, `src/game` : interface React.

```
npm install
npm run dev      # lancer en local
npx vitest run   # tests du moteur
```

Chaque envoi sur `main` lance les tests puis met le jeu en ligne sur GitHub Pages.

Sons : pack « Casino Audio » de Kenney (www.kenney.nl), licence CC0 (public/sfx).
