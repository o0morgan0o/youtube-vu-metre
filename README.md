# YouTube · Vu-mètre

Extension Chrome locale qui affiche les niveaux audio gauche/droite dans le lecteur YouTube, sur une vidéo ou un live, **même lorsque le lecteur est en sourdine ou que son volume est à zéro**.

## Installation — une seule fois

1. Ouvrir `chrome://extensions` dans Chrome.
2. Activer le **Mode développeur** en haut à droite.
3. Cliquer sur **Charger l’extension non empaquetée**.
4. Sélectionner ce dossier (celui qui contient `manifest.json`) :

   ```text
   /home/morgan/youtube-vu-metre
   ```

5. Recharger les onglets YouTube déjà ouverts.
6. Dans le menu **Extensions** (pièce de puzzle) de Chrome, épingler **YouTube · Vu-mètre** pour garder son icône dans la barre d’outils.
7. Lancer une vidéo ou un live, cliquer sur l’icône de l’extension pour afficher le panneau, puis sur **Activer** pour mesurer le son.

Le clic sur **Activer** autorise Chrome à démarrer l’analyse audio. Elle reste active lorsque l’on passe à une autre vidéo dans le même onglet. Après un rechargement complet, cliquer de nouveau sur **Activer**.

Pour mettre à jour une installation existante : cliquer sur **Recharger** sur la fiche de l’extension dans `chrome://extensions`, puis recharger les onglets YouTube.

## Utilisation

- Le panneau est **masqué par défaut** dans chaque nouvel onglet. Un clic sur l’icône de l’extension l’affiche ; un second clic le masque entièrement et arrête l’analyse audio. Aucun panneau réduit ne reste à l’écran.
- Le badge **ON** indique que l’affichage est activé pour cet onglet. Le choix afficher/masquer est conservé lors des changements de vidéo et des rechargements, jusqu’à la fermeture de l’onglet ou au redémarrage de Chrome. Chaque onglet a son propre choix.
- Après avoir réaffiché le panneau, cliquer sur **Activer** pour reprendre la mesure.
- Les deux barres **G / D** affichent le niveau moyen RMS en **dBFS**, avant le volume du lecteur. Un signal mono apparaît sur les deux barres.
- Le trait blanc maintient la crête récente pendant une seconde. **Crête** conserve le maximum observé ; cliquer dessus le remet à zéro.
- Vert : niveau faible à modéré ; jaune : niveau élevé ; rouge : proche de 0 dBFS. Ce n’est pas une mesure LUFS ni un détecteur de true peak.
- **↔** déplace le panneau de l’autre côté. **− / +** réduit ou agrandit le panneau.
- **Arrêter** libère la capture. Le bouton muet et le volume YouTube continuent de fonctionner normalement.
- Le panneau fait partie du lecteur et reste visible en mode cinéma et en plein écran classique. Il n’est pas affiché dans la fenêtre vidéo Picture-in-Picture.

Le vu-mètre continue à mesurer un lecteur **en lecture et en sourdine**. Une vidéo en pause ou en attente de données ne fournit pas de nouveau son à mesurer. Le panneau peut afficher un niveau nul pendant un passage silencieux.

## Fonctionnement et confidentialité

L’extension utilise `HTMLMediaElement.captureStream()` puis Web Audio pour lire une copie du signal décodé. La [spécification Media Capture from DOM Elements](https://www.w3.org/TR/mediacapture-fromelement/#html-media-element-media-capture-extensions) précise que le mute et le volume de l’élément n’affectent pas l’audio capturé.

La copie audio n’est jamais reliée aux haut-parleurs. L’extension ne change ni `muted`, ni `volume`, ni la lecture du lecteur original. Aucun microphone, enregistrement, serveur externe ou compte n’est utilisé. Les échantillons sont analysés en mémoire, localement.

L’extension n’a pas de dépendance ni d’étape de compilation. Son script est limité à `www.youtube.com` et aux lecteurs intégrés `www.youtube-nocookie.com`. La permission `storage` sert uniquement à mémoriser l’affichage par onglet pendant la session Chrome. Elle ne demande aucune permission de capture de l’écran ou du microphone.

## Limites et dépannage

- Si le panneau n’apparaît pas : recharger YouTube après l’installation, ouvrir une vidéo ou un live et cliquer sur l’icône de l’extension.
- Si Chrome suspend l’analyse : cliquer sur **Reprendre**.
- Les contenus protégés par DRM et les médias dont l’origine interdit la capture peuvent être inaccessibles ; l’extension ne contourne pas ces protections.
- Une modification future du lecteur YouTube peut nécessiter une mise à jour de l’extension.
- Pour désinstaller : supprimer l’extension dans `chrome://extensions`, puis recharger les onglets YouTube.

## Vérification technique

Tests exécutés dans Chromium 152 avec l’extension réellement chargée, sur un lecteur local servi sous une adresse YouTube simulée : stéréo calibrée, mute, volume nul/faible, pause, changement de source, mono, remplacement du lecteur, arrêt/reprise, réduction et déplacement. Un flux audio/vidéo **MediaSource** à durée infinie avec ajout d’un nouveau segment vérifie le cas d’un flux continu, sans arrêter l’image originale.

Ces tests ne remplacent pas une vérification manuelle sur un véritable live YouTube et sur ses éventuelles publicités.

Les tests vérifient aussi l’affichage masqué par défaut, le masquage complet pendant une mesure, la reprise, la persistance après rechargement, les clics rapides et l’indépendance des onglets. Le navigateur de test étant sans interface, le gestionnaire du bouton de la barre d’outils est appelé dans le véritable service worker ; les messages et le stockage utilisent les API Chrome réelles.

Relancer les tests depuis la racine du projet avec Node.js 22+, Chromium, OpenSSL et FFmpeg (encodeurs libvpx/libvorbis) :

```sh
node tests/browser.mjs
```

Le test crée un profil navigateur et un serveur HTTPS temporaires sur la boucle locale. Il ne touche pas au profil Chrome habituel. La variable `CHROMIUM` permet de sélectionner un autre exécutable Chromium ; `SCREENSHOT` permet de sauvegarder une capture du résultat.
