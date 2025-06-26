require("dotenv").config();

const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const { MongoClient } = require('mongodb');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

const uri = process.env.MONGODB_URI;
const mongoCl = new MongoClient(uri);

const app = express();
app.get('/', (req, res) => {
  res.send('Bot is alive!');
});

app.listen(3000, () => {
  console.log('Webサーバーが起動しました（ポート3000）');
});

const systemData = {
  ftStart : true,
  isBusy : true,
  serverList : [],
  serverData : {}
};

const PREFIX = "<dev>";

async function dbConnect(mode){
  if(mode === true){
    try {
      console.log("DBへ接続をリクエストしました");
      await mongoCl.connect();
      console.log("接続成功");
    } catch(e){
      console.log(`接続に失敗しました：${e}`);
    }
  } else if(mode === false){
    try {
      await mongoCl.close();
      console.log("DBとの接続を解除しました");
    } catch(e){
      console.log(`切断処理に失敗しました：${e}`);
    }
  } else {
    console.error("引数を正しく設定してください");
    return null;
  }
}

async function dbControl(jsonData,mode){
  const re = {mode : false , data : null};
  try{
    const db = mongoCl.db("ArusBot");
    const col = db.collection("system");

    if(mode === "write"){
      const res = await col.insertOne(jsonData);
      console.log(`保存に成功しました`,`ID:${res.insertedId}`);
    } else if(mode === "load"){
      const res = await col.findOne(jsonData);
      if(res){
        console.log("読み込み結果：",res);
        re.mode = true;
        re.data = res;
      } else {
        console.log("該当するデータが見つかりませんでした");
        re.mode = true;
      }
    } else if(mode === "update"){
      if(!(jsonData.findTarget) || !(jsonData.updateProp)){
        throw new Error("正しく引数を設定してください");
      }
      const res = await col.updateOne(jsonData.findTarget,{$set : jsonData.updateProp},{upsert : true});
      if(res.matchedCount > 0){
        console.log(`${res.matchedCount}件が条件に合致しました`);
      }
      if(res.modifiedCount > 0){
        console.log("データが更新されました");
      } else {
        console.log("データに変更はありません");
      }
    } else {
      throw new Error("modeが正しく指定されていません");
    }

  }catch(e){
    console.log(`エラーが発生しました：${e}`);
  }finally{
    if(re.mode){
      console.log("returnされました");
      return re.data;
    }
  }
}

client.once('ready', () => {
  console.log(client.user.tag + "でログインしました！");
  if(systemData.ftStart === true){
    async function onceRun(){
      await dbConnect(true);
      const res = await dbControl({dataName : "serverList"},"load");
      if(res){
        systemData.serverList = res.serverList;
      } else {
        const obj = {
          dataName : "serverList",
          serverList : []
        }
        await dbControl(obj,"write");
        systemData.serverList = obj.serverList;
      }
      if(systemData.serverList.length > 0){
        for(const d of systemData.serverList){
          const res = await dbControl({dataName : d},"load");
          if(res){
            systemData.serverData[d] = {};
            systemData.serverData[d].sayChannel = res.sayChannel;
          }
        }
      }
      await dbConnect(false);
      systemData.ftStart = false;
      systemData.isBusy = false;
      console.log("データ構築完了："+ JSON.stringify(systemData,null,2));
    }
    onceRun();
  }
});

client.on('messageCreate', (message) => {
  if(message.author.bot || !message.guild){return;}
  if(systemData.isBusy === true){return;}
  if(!message.content.startsWith(PREFIX)){return;}

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if(!(message.author.id === process.env.MASTER_ID)){
    message.reply("ごめんね、君のそのコマンドには従えないよ。\n<dev>コマンドはArusBotのマスター権限を持つ人のみが使えるよ。");
    return;
  }


  if(command === "setup"){
    systemData.isBusy = true;
    const gId = message.channel.guildId;
    const cId = message.channel.id;
    let sw = false;
    if(systemData.serverList.length > 0){
      for(const cg of systemData.serverList){
        if(cg === gId){
          sw = true;
        }
      }
    }
    if(!(sw)){
      systemData.serverList.push(gId);
      systemData.serverData[gId] = {};
    }
    systemData.serverData[gId].sayChannel = cId;
    (async function(){
      await dbConnect(true);
      const res = await dbControl({dataName : gId},"load");
      if(res){
        console.log("サーバー情報を更新します");
        await dbControl({
          findTarget : {dataName : gId},
          updateProp : {sayChannel : cId}
        },"update");
        console.log("サーバー情報の更新が完了しました")
      } else {
        console.log("サーバー情報を新規に保存します");
        await dbControl({
          dataName : gId,
          sayChannel : cId
        },"write");
        console.log("サーバー情報の新規保存が完了しました");
      }
      if(!(sw)){
        console.log("serverListを更新します");
        await dbControl({
          findTarget : {dataName : "serverList"},
          updateProp : {serverList : systemData.serverList}
        },"update");
        console.log("serverListの更新が完了しました");
      }
      await dbConnect(false);
      systemData.isBusy = false;
      message.reply("このサーバーのArusBotの設定を更新したよ！");
      console.log("現在のデータ："+ JSON.stringify(systemData,null,2));
    })();
  }
});

function serverCheck(targetId){
  let jud = false;
  if(systemData.serverList.length > 0){
    for(const id of systemData.serverList){
      if(id === targetId){
        jud = true;
      }
    }
  }
  console.log("サーバー照合判定：",jud);
  return jud;
}
client.on("voiceStateUpdate",async (oldState,newState) => {
  if(systemData.isBusy === true){return;}
  if(!(oldState.channelId !== newState.channelId)){return;}
  if(oldState.channel){
    if(oldState.member.user.bot){return;}
    const gId = oldState.channel.guildId;
    if(!(serverCheck(gId))){
      console.log("未登録のサーバーからのリクエストのため拒否しました");
      return;
    }
    const cId = systemData.serverData[gId].sayChannel;
    
    console.log("退出検知");
    console.log(`退出したサーバー：${oldState.channel.name}`);
    console.log(`退出した人：${oldState.member.displayName}`);
    let ch = client.channels.cache.get(cId);
    if(!(ch)){
      ch = await client.channels.fetch(cId);
    }
    await ch.send(`${oldState.member.displayName}さんが｢${oldState.channel.name}｣から退出したよ！`);
    if(oldState.channel.members.size === 0){
      await ch.send(`｢${oldState.channel.name}｣の通話が終了したよ！`);
    }
  }
  if(newState.channel){
    if(newState.member.user.bot){return;}
    const gId = newState.channel.guildId;
    if(!(serverCheck(gId))){
      console.log("未登録のサーバーからのリクエストのため拒否しました");
      return;
    }
    const cId = systemData.serverData[gId].sayChannel;
    
    console.log("入室検知");
    console.log(`入室したサーバー：${newState.channel.name}`);
    console.log(`入室した人：${newState.member.displayName}`);
    let ch = client.channels.cache.get(cId);
    if(!(ch)){
      ch = await client.channels.fetch(cId);
    }
    if(newState.channel.members.size === 1){
      await ch.send(`｢${newState.channel.name}｣の通話が開始したよ！`);
    }
    await ch.send(`${newState.member.displayName}さんが｢${newState.channel.name}｣に入室したよ！`);
  }
});

client.login(process.env.TOKEN);