"""Preserva fontes e sondagens públicas, sem autenticar ou enviar registros W&B."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--folder',type=Path,default=Path('downloads/research/resolution-source-metadata'))
    args=p.parse_args();folder=args.folder;folder.mkdir(parents=True,exist_ok=True)
    repos=[('lstom','bytedance/midi_melody_extraction','106f1d9a6e96f9e9d0ad9cbacb47f9ae17c60c72'),
           ('vocsep','manoskary/vocsep_ijcai2023','82152a9591ba2759a556a6f9f52fd8eab771ca4a')]
    result=[]
    for name,repo,commit in repos:
        path=folder/name
        if not path.exists():
            subprocess.run(['git','clone','--filter=blob:none','--no-checkout','https://github.com/'+repo+'.git',str(path)],check=True)
            subprocess.run(['git','checkout',commit],cwd=path,check=True)
        actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=path,text=True).strip()
        if actual!=commit:raise RuntimeError(f'Checkout inesperado em {path}; não modificar automaticamente')
        files=subprocess.check_output(['git','ls-files'],cwd=path,text=True).splitlines()
        releases=json.load(urllib.request.urlopen(urllib.request.Request('https://api.github.com/repos/'+repo+'/releases',headers={'User-Agent':'motor-orchestra-research'})))
        result.append(dict(repo=repo,commit=actual,files=files,releases=releases,
          fileHashes={name:hashlib.sha256((path/name).read_bytes()).hexdigest() for name in files}))
    path=folder/'vocsep-anonymous-graphql.json'
    if not path.exists():
        payload=json.dumps({'query':'query { project(name: "Voice Separation", entityName: "vocsep") { name } }'}).encode()
        request=urllib.request.Request('https://api.wandb.ai/graphql',data=payload,headers={'Content-Type':'application/json'},method='POST')
        try:
            response=urllib.request.urlopen(request,timeout=20);value=dict(status=response.status,body=response.read().decode())
        except Exception as error:value=dict(type=type(error).__name__,reason=str(error))
        path.write_text(json.dumps(value,indent=2)+'\n')
    sdk=folder/'vocsep-artifact-probe.json'
    if not sdk.exists():
        # A consulta anônima não exige instalar W&B, PyTorch ou torch_scatter.
        sdk.write_text(json.dumps(dict(status='not-repeated',reason='SDK probe not repeated; inspect anonymous GraphQL response and original archived evidence.'),indent=2)+'\n')
    (folder/'external-inspection.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Sources inspected and public probe preserved:',folder)


if __name__=='__main__':main()
