# PZ Rank Companion

App de sincronização automática para o **PZ Community Rank**. Monitora os arquivos gerados pelo mod e envia os dados ao site do ranking sem nenhuma intervenção manual.

---

## Como funciona

1. O mod **PZCommunityRank** gera arquivos `.txt` com os dados da run em `%USERPROFILE%\Zomboid\Lua\pz_rank\`
2. O Companion detecta o arquivo e envia o código ao backend via API
3. O ranking é atualizado automaticamente

```
Project Zomboid
    └── mod PZCommunityRank
            └── gera .txt ──► Companion (monitorando pasta)
                                    └── POST /sync/update ──► pz-rank.vercel.app
```

---

## Requisitos

- Windows 10/11
- Mod [PZCommunityRank](https://github.com/lbcamargo94/PZCommunityRank) instalado e ativo no jogo
- Conta registrada em [pz-rank.vercel.app](https://pz-rank.vercel.app)

---

## Instalação

Baixe o instalador ou o executável portátil na página de [Releases](https://github.com/lbcamargo94/PZ-Rank-Companion/releases):

| Arquivo | Descrição |
|---|---|
| `PZ Rank Companion Setup 1.0.0.exe` | Instalador NSIS (instala no sistema) |
| `PZ Rank Companion 1.0.0.exe` | Portátil (não instala, execute direto) |

---

## Configuração inicial

1. Abra o app — uma janela de configuração abrirá automaticamente
2. No campo **Nick do Rank**, digite o seu nick exatamente como aparece no site do ranking
3. Clique em **Conectar** — o app buscará seu cadastro no site
4. Pronto. O app vai para a bandeja do sistema e começa a monitorar

> O nick deve corresponder ao cadastro no site. Não é necessariamente o nick da Steam.

---

## Uso diário

- O app roda em segundo plano na **bandeja do sistema** (system tray)
- Clique duplo no ícone para abrir a janela principal
- Ao morrer no jogo (ou ao salvar, subir de nível, a cada ~5 min), o mod gera um arquivo e o Companion sincroniza automaticamente
- Uma notificação do Windows confirma o sync com o nome do personagem e a pontuação

### Badges de status

| Badge | Significado |
|---|---|
| `▶ Jogo ativo` | ProjectZomboid64.exe detectado em execução |
| `◻ Jogo não detectado` | Jogo fechado ou não iniciado |
| `Sync OK ✓` | Último arquivo sincronizado com sucesso |
| `Monitorando...` | Aguardando novos arquivos do mod |
| `⚠ Erro na pasta` | Pasta de monitoramento inacessível |

---

## Configurações

Acessíveis pela janela principal (ícone de engrenagem ou seção inferior):

- **Pasta monitorada** — caminho onde o mod salva os `.txt`. Padrão: `%USERPROFILE%\Zomboid\Lua\pz_rank\`. Use o botão 📁 para escolher outro local
- **Iniciar com o Windows** — inicia o Companion automaticamente no boot
- **Desconectar** — remove o vínculo com a conta (permite trocar de nick)

---

## Build (desenvolvimento)

```bash
# Instalar dependências
npm install

# Rodar em modo desenvolvimento
npm start

# Gerar instalador + portátil para Windows (x64)
npm run dist
```

Requer Node.js 18+ e npm.

> **Nota sobre code signing:** o build está configurado sem assinatura (`sign: null`). O Windows Defender pode exibir aviso ao executar — isso é esperado para builds não assinados.

---

## Estrutura

```
PZ-Rank-Companion/
├── main.js          # Processo principal Electron (tray, IPC, watcher, sync)
├── preload.js       # Bridge contextBridge entre main e renderer
├── renderer/
│   ├── index.html   # UI principal
│   ├── app.js       # Lógica da UI (setup, status, settings)
│   └── style.css    # Estilos
└── assets/
    ├── icon.png     # Ícone da janela
    └── tray.png     # Ícone da bandeja
```

---

## Projetos relacionados

| Repositório | Descrição |
|---|---|
| [PZ-Rank](https://github.com/lbcamargo94/PZ-Rank) | Backend da API e site do ranking |
| [PZCommunityRank](https://github.com/lbcamargo94/PZCommunityRank) | Mod do Project Zomboid que gera os arquivos |
