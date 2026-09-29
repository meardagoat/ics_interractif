# Planning MSc 1 — Epitech

Calendrier interactif généré à partir de l'export `.ics` du planning MSc 1.

**En ligne :** https://meardagoat.github.io/ics_interractif/

## Fonctionnalités

- Vues année / mois / semaine / liste (en français)
- Prochain cours avec compte à rebours (ou « en cours »)
- Statistiques : séances, heures, progression de l'année
- Liste des prochains cours et bandeau défilant
- Filtres par type de cours et recherche
- Détail d'un cours + ajout à Google Agenda / export `.ics`
- Design inspiré de la DA Epitech (Anton, IBM Plex, bleu #013AFB), animations et curseur custom
- Raccourcis clavier (`←` `→` `t` `/`) actifs dans la section calendrier

## Accessibilité

Le site est utilisable au clavier seul et avec un lecteur d'écran (VoiceOver, NVDA, JAWS) :

- Liens d'évitement vers le calendrier et la liste des prochains cours
- Structure sémantique : repères (`nav`, `main`, `footer`), titres hiérarchisés, listes
- Chaque cours est un bouton focusable avec un libellé complet (titre, date, horaire, statut)
- Annonces vocales : chargement, nombre de résultats de recherche, changement de période ou de filtre
- Compte à rebours et statistiques animées doublés d'un texte lisible par les lecteurs d'écran
- Fiche de cours dans une vraie boîte de dialogue (focus piégé, `Échap` pour fermer)
- Focus visible, contrastes WCAG AA, animations désactivées si « réduire les animations » est activé
- Audit axe-core (WCAG 2.1 AA) : 0 violation sur toutes les vues

## Mettre à jour le planning

Remplacer `calendar.ics` par le nouvel export puis pousser sur `main`.

## Lancer en local

```bash
npm start   # puis ouvrir http://localhost:8080
```
