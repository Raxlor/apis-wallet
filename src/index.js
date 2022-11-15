const express = require('express')
const bodyParser = require("body-parser");
const mongoose = require('mongoose');
const fetch = require("node-fetch");
var TronWeb = require('tronweb');
const BigNumber = require('bignumber.js');

require('dotenv').config();
var cors = require('cors');

const tiempoWallets = 3600000 / 20; //test para realizar una pequeña prueba
const minTRX = 10000000;
const minTRX_enviar =50000000;
const minDeposit = 1;

const port = process.env.PORT || "3003";
const TOKEN = process.env.APP_MT;
const uri = process.env.APP_URI;
const pik = process.env.APP_PRYKEY;

const servidorMails = process.env.APP_SERVER_MAIL || "https://brutusgroup.tk/mails/mail-digital-kingdom.php";

var TRONGRID_API = process.env.APP_API || "https://api.trongrid.io";
var TRONGRID_API_EVENT = process.env.APP_API_EVENT || "https://api.trongrid.io";
var contractAddress = process.env.APP_CONTRACT || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
var InfoEmail = process.env.APP_INFO_EMAIL || "It@digitalkingdomgroup.com";

const Testnet = process.env.APP_TESTNET || "false";

if (Testnet === "true") {

  TRONGRID_API = "https://api.nileex.io";
  TRONGRID_API_EVENT = "https://event.nileex.io";
  contractAddress = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";

  console.log("Conectado a la TESNET")

}

const delay = (s) => new Promise((res) => setTimeout(res, s * 1000));


var tronWeb = new TronWeb(
  TRONGRID_API,
  TRONGRID_API,
  TRONGRID_API_EVENT,
  pik
);

const MasterWallet = tronWeb.defaultAddress.base58;
const DepositWallet = process.env.APP_DEPOSITWALLET || MasterWallet;

console.log("Master Wallet: " + MasterWallet);
console.log("Desposit Wallet: " + DepositWallet)

var contractUSDT;

tronWeb.contract().at(contractAddress)
  .then((result) => {
    console.log("contrato conectado [" + contractAddress + "]");
    contractUSDT = result;
    //console.log(contractUSDT);
  })

const app = express();

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
const options = { useNewUrlParser: true, useUnifiedTopology: true };

mongoose.connect(uri, options)
  .then(async () => { console.log("Conectado Exitodamente a la base de datos"); })
  .catch(err => { console.log(err); });

const walletsTemp = mongoose.model('wallets', {

  wallet: String,
  data: Object,
  ultimoUso: Number,
  usuario: String,
  disponible: Boolean,
  usos: Number

});

const transferencias = mongoose.model('transfer', {

  identificador: Number,
  tipo: String,
  moneda: String,
  cantidad: Number,
  from: String,
  to: String,
  time: Number,
  usuario: String,
  timeCompletado: Number,
  completado: Boolean,
  pendiente: Boolean,
  cancelado: Boolean

});

async function crearWallet() {
  var acc = await tronWeb.createAccount()
  await asignarTRX(acc.address.base58);

  acc = {
    wallet: acc.address.base58,
    data: acc,
    ultimoUso: Date.now(),
    usuario: "",
    disponible: true
  };

  var newWallet = new walletsTemp(acc);
  await newWallet.save();

  return acc;


}

/**
 * It checks if the wallet has less than the minimum amount of TRX required to participate in the game,
 * and if it does, it sends the minimum amount of TRX to the wallet
 * @param wallet - The wallet address you want to send TRX to.
 * @returns a boolean value.
 */
async function asignarTRX(wallet) {
  var balance = await tronWeb.trx.getBalance(wallet);

  if (balance < minTRX) {

    console.log("asignar TRX")
    var hash = await tronWeb.trx.sendTransaction(wallet, minTRX_enviar);
    console.log("hash: " + hash.txid);

    await delay(60);

    return true;

  } else {

    return false;
  }

}

async function buscarWalletsDisponibles() {

  var update = await walletsTemp.updateMany(
    {
      disponible: false
    },
    [

      {
        $set: {
          usuario: {
            $switch:
            {
              branches: [
                {
                  case: { $gte: [Date.now(), { $sum: ["$ultimoUso", tiempoWallets] }] },
                  then: ""
                }],
              default: "$usuario"
            }
          }
        }
      },
      {
        $set: {
          disponible: {
            $switch:
            {
              branches: [
                {
                  case: { $gte: [Date.now(), { $sum: ["$ultimoUso", tiempoWallets] }] },
                  then: true
                }],
              default: "$disponible"
            }
          }
        }
      },
      {
        $set: {
          ultimoUso: {
            $switch:
            {
              branches: [
                {
                  case: { $gte: [Date.now(), { $sum: ["$ultimoUso", tiempoWallets] }] },
                  then: Date.now()
                }],
              default: "$ultimoUso"
            }
          }
        }
      }


    ]




  )
  //console.log(update);

}

async function buscarMisTransferencias() {


  var update = await transferencias.updateMany({ completado: false, cancelado: false },
    [

      {
        $set: {
          timeCompletado: {
            $switch:
            {
              branches: [
                {
                  case: { $gte: [Date.now(), { $sum: ["$time", tiempoWallets] }] },
                  then: Date.now()
                }],
              default: "$timeCompletado"
            }
          }
        }
      },
      {
        $set: {
          cancelado: {
            $switch:
            {
              branches: [
                {
                  case: { $gte: [Date.now(), { $sum: ["$time", tiempoWallets] }] },
                  then: true
                }],
              default: "$cancelado"
            }
          }
        }
      },
      {
        $set: {
          pendiente: {
            $switch:
            {
              branches: [
                {
                  case: { $gte: [Date.now(), { $sum: ["$time", tiempoWallets] }] },
                  then: false
                }],
              default: "$pendiente"
            }
          }
        }
      }

    ]

  )
  //console.log(update);

}

async function cancelarMiTransferencia(id) {

  if (id) {

    var miTransfers = await transferencias.find({ identificador: id })

    if (miTransfers.length > 0) {

      if (!miTransfers[0].completado) {

        var update = await walletsTemp.updateOne({ wallet: miTransfers[0].to },
          [
            { $set: { disponible: true, usuario: "" } }
          ]
        )

        update = await transferencias.updateOne({ identificador: id },
          [

            { $set: { timeCompletado: Date.now() } },
            { $set: { cancelado: true } },
            { $set: { pendiente: false } }

          ]

        )
        console.log(update);
        return true;

      } else {
        return false;
      }


    } else {
      return false;
    }

  } else {
    return false;
  }



}

buscarMisTransferencias();

buscarWalletsDisponibles();

app.get('/', async (req, res) => {

  res.send("ok")


});

async function consultar(apiUrl) {
  const response = await fetch(apiUrl)
    .catch(error => { console.error(error) })
  const json = await response.json();

  return json;

}

app.get('/precio/usd/trx', async (req, res) => {
  /*
    let data = await CoinGeckoClient.simple.price({
        ids: ['tron'],
        vs_currencies: ['usd']
    });
    //console.log(data);*/

  const json = await consultar('https://data.gateapi.io/api2/1/marketlist');

  var upd = json.data.find(element => element.pair == "trx_usdt");

  //console.log(upd.rate);

  res.status(200).send({
    "data": {
      "tron": {
        "usd": parseFloat(upd.rate)
      }
    }
  })

});
// no utilizar da error, corrompe la app
app.get('/consultar/transaccion/:id', async (req, res) => {

  await buscarWalletsDisponibles();

  let id = req.params.id;

  var evento = await tronWeb.getEventByTransactionID(id)
  evento = evento[0];

  console.log(evento)

  var value = await tronWeb.trx.getTransaction(id)

  //console.log(value)
  //  console.log(value.ret[0].contractRet);

  if (value.ret[0].contractRet === 'SUCCESS' && evento.name === 'Transfer') {

    value = new BigNumber(evento.result.value);
    value = value.shiftedBy(-6).toNumber();

    res.send({
      result: true,
      value: value,
      from: tronWeb.address.fromHex(evento.result.from),
      to: tronWeb.address.fromHex(evento.result.to),
      time: Date.now()
    });
  } else {
    res.send({
      result: false,
      value: 0
    });
  }


});


async function enviarUSDT(wallet, cantidadUSDT) {

  var contractUSDT = await tronWeb.contract().at(contractAddress);

  cantidadUSDT = parseInt(cantidadUSDT * 10 ** 6);

  if (cantidadUSDT < 1) return "";

  var hash = await contractUSDT.transfer(wallet, cantidadUSDT).send().catch(() => { return ""; })

  return hash;

}


app.post('/enviar/usdt', async (req, res) => {
  await buscarWalletsDisponibles();

  if (req.body.envios.length) {
    var envios = req.body.envios;
  } else {
    var envios = JSON.parse(req.body.envios);
  }

  if (req.body.token === TOKEN && req.body.envios && envios.length) {
    var respuesta = { result: true };
    respuesta.data = [];
    for (let index = 0; index < envios.length; index++) {
      hash = await enviarUSDT(envios[index].wallet, envios[index].cantidad).catch(() => { return ""; })
      if (hash === "") {
        ok = false;
      } else {
        ok = true;
      }

      respuesta.data.push({ ok: ok, wallet: envios[index].wallet, cantidad: envios[index].cantidad, hash: hash, time: Date.now() })
    }



    res.send(respuesta)
  } else {
    res.send({ result: false })
  }

});

app.post('/crear/deposito/', async (req, res) => {

  await buscarWalletsDisponibles();

  var usuario = parseInt(req.body.id);

  if (req.body.token === TOKEN && req.body.id && !isNaN(usuario)) {

    var miTransfers = [];

    var miTransfers = await transferencias.find({ usuario: usuario }).sort({ identificador: -1 }).catch(() => { return [] })

    //console.log(miTransfers[0].usuario)

    var neworden = false;
    var ident = 0;
    if (miTransfers.length > 0) {
      for (let index = 0; index < miTransfers.length; index++) {

        if (miTransfers[index].pendiente && !miTransfers[index].completado && !miTransfers[index].cancelado) {
          neworden = true;
          ident = index;
          await verificarDeposito(miTransfers[ident].identificador);
          console.log("orden pendiente " + miTransfers[ident].identificador)
          break;
        }

      }
    }

    //crear nueva orden de deposito?
    if (!neworden) {

      var walletDeposito = await walletsTemp.find({ disponible: true }).sort({ ultimoUso: -1 })

      if (walletDeposito.length === 0) {
        walletDeposito[0] = await crearWallet();
      }

      console.log("crea nueva orden: " + walletDeposito[0].wallet)

      // se retira el balance hacia la master
      await retirarBalance(walletDeposito[0].wallet)

      await walletsTemp.updateOne({ wallet: walletDeposito[0].wallet },
        { $set: { disponible: false, usuario: usuario } })

      var totalTranfers = await transferencias.find({}).sort({ identificador: -1 });
      if (totalTranfers.length > 0) {
        var identificador = totalTranfers.length;
      } else {
        identificador = 0;
      }


      var newtransfer = new transferencias({

        identificador: identificador,
        tipo: "deposito",
        moneda: "usdt(trc20)",
        cantidad: 0,
        from: "",
        to: walletDeposito[0].wallet,
        time: Date.now(),
        usuario: req.body.id,
        timeCompletado: 0,
        completado: false,
        pendiente: true,
        cancelado: false

      });

      await newtransfer.save();

      res.send({
        result: true,
        sendTo: walletDeposito[0].wallet,
        ordenId: identificador,
        time: newtransfer.time,
        end: newtransfer.time + tiempoWallets
      });
    } else {

      res.send({
        result: true,
        sendTo: miTransfers[ident].to,
        ordenId: miTransfers[ident].identificador,
        time: miTransfers[ident].time,
        end: miTransfers[ident].time + tiempoWallets
      });

    }

  } else {
    res.send({
      result: false,
      time: Date.now()
    });
  }


});

async function retirarBalance(wallet) {

  var estawallet = await walletsTemp.find({ wallet: wallet }).catch(() => { console.log("wallet inexistente"); return ""; })
  estawallet = estawallet[0];

  var TEMPtronWeb = new TronWeb(
    TRONGRID_API,
    TRONGRID_API,
    TRONGRID_API_EVENT,
    estawallet.data.privateKey
  );

  var tempUST = await TEMPtronWeb.contract().at(contractAddress);
  var cantidad = await contractUSDT.balanceOf(wallet).call()
  cantidad = new BigNumber(cantidad._hex).toString();
  //console.log(cantidad)
  if (cantidad > minDeposit) {

    var hash = await tempUST.transfer(DepositWallet, cantidad).send().catch(() => { console.log("error sacar fondos"); return ""; })

  } else {
    hash = "";
  }

  delete TEMPtronWeb;

  return hash;
}

async function enviarMail(mensaje) {

  await consultar(servidorMails + "?destino=" + InfoEmail + "&html=" + mensaje + "&token=crypto2021")


}

app.post('/enviar/mailto/', async (req, res) => {

  if (req.body.token === TOKEN && req.body.mail && req.body.mensaje) {
    var result = await fetch(servidorMails + "?destino=" + req.body.mail + "&html=" + req.body.mensaje + "&token=crypto2021")
    result = await result.text();
    result = JSON.parse(result); result.result
    //await enviarMail("que hace x2");
    res.send({ result: result.result });
  } else {
    res.send({ result: false });

  }

})




async function verificarDeposito(id) {

  //console.log("consultar id: " + id)

  if (id) {

    var totalTranfers = await transferencias.find({ identificador: id }).sort({ time: -1 })

    if (totalTranfers.length > 0) {
      for (let index = 0; index < totalTranfers.length; index++) {
        var value = await contractUSDT.balanceOf(totalTranfers[index].to).call()
        value = new BigNumber(value._hex).shiftedBy(-6).toNumber();
        //console.log(value)
        if (value > 0) {

          var asing = await asignarTRX(totalTranfers[index].to);

          if (!asing) {

            hash = await retirarBalance(totalTranfers[index].to);

            if (hash !== "") {

              //enviarMail("wallet: " + totalTranfers[index].to + " se uso para un pago de: " + value + " USDT en la red de Tron")
              await transferencias.updateOne({ identificador: id },
                [
                  {
                    $set: {
                      cantidad: value, from: hash, timeCompletado: Date.now(), completado: true, pendiente: false
                    }
                  }
                ]
              )
              await walletsTemp.updateOne({ wallet: totalTranfers[index].to },
                [
                  { $set: { disponible: true, usuario: "", usos: { $sum: ["$usos", 1] } } }
                ]

              )
            }


          }

        }

      }

    }

  }

}

/* The above code is a POST request to the /consultar/deposito/id/ endpoint. It is checking if the
token is valid and if the id is a number. If it is, it will check the database for the id and return
the data. */
app.post('/consultar/deposito/id/', async (req, res) => {

  let id = parseInt(req.body.id);

  if (req.body.token !== TOKEN || isNaN(id)) {
    res.send({
      result: false,
      time: Date.now()
    });
  } else {

    await verificarDeposito(id);

    var totalTranfers = await transferencias.find({ identificador: id }).sort({ time: -1 })

    if (totalTranfers.length > 0) {

      res.send({
        result: true,
        idDeposito: id,
        data: totalTranfers[0],
        time: Date.now()
      });

    } else {

      res.send({
        result: false,
        time: Date.now()
      });

    }

  }

  await buscarWalletsDisponibles();

});

app.post('/consultar/depositos/usuario/', async (req, res) => {

  let id = parseInt(req.body.id);

  if (req.body.token !== TOKEN || isNaN(id)) {
    res.send({
      result: false,
      time: Date.now()
    });
  } else {

    var miTransfers = await transferencias.find({ usuario: id, tipo: "deposito" }, { _id: 0, __v: 0, usuario: 0 }).sort({ identificador: -1 });

    if (miTransfers.length > 0) {

      res.send({
        result: true,
        usuario: id,
        data: miTransfers,
        time: Date.now()
      });
    } else {
      res.send({
        result: false,
        time: Date.now()
      });
    }
  }

  await buscarWalletsDisponibles();



});

/* The above code is a POST request to the /cancelar/deposito/id/ endpoint. It is canceling a deposit. */
app.post('/cancelar/deposito/id/', async (req, res) => {

  let id = parseInt(req.body.id);

  if (req.body.token !== TOKEN || isNaN(id)) {

    res.send({
      id_recibida: id,
      result: false,
      time: Date.now()
    });
  } else {

    await verificarDeposito(id);

    if (await cancelarMiTransferencia(id)) {

      res.send({
        result: true,
        idDeposito: id,
        time: Date.now()
      });
    } else {
      res.send({
        idDeposito: id,
        result: false,
        time: Date.now()
      });
    }

  }
  await buscarWalletsDisponibles();

});

app.get('/consultar/masterwallet/', async (req, res) => {

  const json = await fetch("https://tronpulse.io/api/wallet/" + MasterWallet)
    .catch(error => { console.error(error) })
    .then((result) => {
      return result.json();
    })

  var value = await contractUSDT.balanceOf(MasterWallet).call();
  value = new BigNumber(value._hex).shiftedBy(-6).toNumber();

  res.send({
    wallet: MasterWallet,
    assets: [
      //modificado para mostrar mayor flujo de informacion de el api
      { usdt: value },
      { trx_disponible: json.data.balance.available },
      { trx_fronzen_E: json.data.balance.frozen_energy },
      { trx_fronzen_B: json.data.balance.frozen_bandwith },
      { trx_fronzen_T: json.data.balance.frozen },
      { trx_total: json.data.balance.total }
    ],
    energy: json.data.resource.energy_available,
    energy_total: json.data.resource.energy_limit,
    bandwith: json.data.resource.bandwith_available,
    bandwith_total: json.data.resource.bandwith_limit
  });

});

app.listen(port, () => console.log('Escuchando Puerto: ' + port))
