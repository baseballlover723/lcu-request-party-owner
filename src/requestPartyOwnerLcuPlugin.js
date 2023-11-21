import LCUPlugin from 'lcu-plugin';
import axios from 'axios';

const CURRENT_SUMMONER_ENDPOINT = 'lol-summoner/v1/current-summoner';
const MEMBERS_ENDPOINT = 'lol-lobby/v2/lobby/members';
const PROMOTE_ENDPOINTS = {
  base: 'lol-lobby/v2/lobby/members',
  suffix: 'promote',
};

const CONVERSATIONS_EVENT = 'OnJsonApiEvent_lol-chat_v1_conversations';

export default class RequestPartyOwnerLcuPlugin extends LCUPlugin {
  onConnect(clientData) {
    axios.defaults.baseURL = `${clientData.protocol}://${clientData.address}:${clientData.port}`;
    axios.defaults.auth = { username: clientData.username, password: clientData.password };
    return this.createPromise((resolve, reject) => {
      this.getCurrentSummoner().then((summonerId) => {
        this.subscribeEvent(CONVERSATIONS_EVENT, this.handleLobbyChat(summonerId));
        resolve();
      }).catch((error) => {
        reject(error);
      });
    });
  }

  getCurrentSummoner(retriesLeft = 20) {
    return this.createPromise((resolve, reject) => {
      this.getCurrentSummonerHelper(retriesLeft, resolve, reject);
    });
  }

  getCurrentSummonerHelper(retriesLeft, resolve, reject) {
    axios.get(CURRENT_SUMMONER_ENDPOINT).then((resp) => {
      resolve(resp.data.summonerId);
    }).catch((error) => {
      if ((error.code !== 'ECONNREFUSED' && error?.response?.status >= 500) || retriesLeft <= 0) {
        console.log('error in getting current summoner', error);
        reject(error);
      }
      setTimeout(() => {
        this.getCurrentSummonerHelper(retriesLeft - 1, resolve, reject);
      }, 1000);
    });
  }

  async getLobbyMembers() {
    return axios.get(MEMBERS_ENDPOINT);
  }

  canPromote(players, summonerId) {
    return players.data.some((player) => summonerId === player.summonerId && !player.isLeader);
  }

  amLeader(currentSummonerId, players) {
    return players.data.some((player) => currentSummonerId === player.summonerId && player.isLeader);
  }

  async promote(summonerId) {
    const promoteUrl = `${PROMOTE_ENDPOINTS.base}/${summonerId}/${PROMOTE_ENDPOINTS.suffix}`;
    return axios.post(promoteUrl);
  }

  handleLobbyChat(currentSummonerId) {
    return async (event) => {
      if (event.eventType !== 'Create') {
        return;
      }
      // console.log('received party chat: ', event);
      if (event.data.type !== 'groupchat') {
        return;
      }
      // console.log('received party chat: ', event);
      if (!/king me/i.test(event.data.body)) {
        console.log(`RequestPartyOwner, ignoring message "${event.data.body}" because it didn't match the regex`);
        return;
      }
      const players = await this.getLobbyMembers();
      if (!this.amLeader(currentSummonerId, players)) {
        console.log('Ignoring request to promote, since I am not party leader');
        return;
      }
      const summonerId = event.data.fromSummonerId;
      if (!this.canPromote(players, summonerId)) {
        console.log(`player ${summonerId} isn't in the party or is already the leader`);
        return;
      }

      await this.promote(summonerId);
    };
  }
}
