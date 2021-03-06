import * as THREE from "three";
import BaseItem from "../BaseItem";
import ImpactAnalyser from "../../audio/ImpactAnalyser";
import { loadImageTextureFromChoice, loadImageTexture } from "editor/animation/util/ImageLoader";

export default class AudioWave extends BaseItem {
    constructor(info) {
        super(info);
        this.name = "Meme Machione";

        this.material = new THREE.MeshPhongMaterial({ transparent: true });
        this.geometry = new THREE.PlaneGeometry(2, 2);
        this.mesh = new THREE.Mesh(this.geometry, this.material);
        this.texLoader = new THREE.TextureLoader();

        this.bpm = 155;
        this.offset = 0;
        this.duration = 0.1;
        this.textures = [];
        info.scene.add(this.mesh);


        this.speedUpThresh2X = 128;
        this.speedUpThresh4X = 128 + 16;
        this.chungusThresh = 160;
        this.darkBeforeChungus = 0 ;
        this.opacityFadeIn = 62;

        var light = new THREE.PointLight( 0xffffff, 1, 100 );
        this.redLight = new THREE.PointLight( 0xff0000, 0.01, 100 );
        this.redLight.position.z = 1;
        
        light.position.z = 1;
        info.scene.add( light );
        info.scene.add( this.redLight );

        this.scene = info.scene;
        this.addLights(info.scene);
        this.setUpFolder();
    }

    addLights = (scene) => {
        this.leftLight = new THREE.PointLight(0xff0000, 0, 100);
        this.rightLight = new THREE.PointLight(0xff0000, 0, 100);

        this.leftLight.position.x = 1;
        this.leftLight.position.y = 1;
        this.leftLight.position.z = 1;


        this.rightLight.position.x = 0.5;
        
        this.rightLight.position.y = 0.7;
        this.rightLight.position.z = 1;

        
        scene.add(this.leftLight);
        scene.add(this.rightLight);
    }

    addTexture = texture => {
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipMaps = false;
        this.textures.push(texture);
    };

    loadChungus = () => {
        loadImageTexture(this, "setChungus");
    }

    setChungus = texture => {
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipMaps = false;
        this.chungus = texture;
    }

    loadImages = () => {
        this.__gui
            .getRoot()
            .modalRef.toggleModal(17)
            .then(files => {
                if (files) {
                    [...files].forEach(file => {
                        loadImageTextureFromChoice(file, this.addTexture);
                    });
                }
            });
    };

    __setUpGUI = folder => {
        this.impactAnalyser = new ImpactAnalyser(folder, this);
        this.addController(folder,this, "loadImages");
        this.addController(folder,this, "loadChungus");
        this.addController(folder,this.leftLight.position, "x").name("left x")
        this.addController(folder,this.leftLight.position, "y").name("left y")
        this.addController(folder,this.leftLight.position, "z").name("left z")
        this.addController(folder,this.leftLight, "intensity").name("left intensity");
        this.addController(folder,this.rightLight.position, "x").name("right x")
        this.addController(folder,this.rightLight.position, "y").name("right y")
        this.addController(folder,this.rightLight.position, "z").name("right z")
        this.addController(folder,this.rightLight, "intensity").name("right intensity");


        this.addController(folder,this, "speedUpThresh4X").name("4x speedup beat threhold");
        this.addController(folder,this, "speedUpThresh2X").name("2x speedup beat threshold");
        this.addController(folder,this, "chungusThresh").name("Chungus beat threshold");
        this.addController(folder,this, "darkBeforeChungus").name("Dark beats before chungus");
        this.addController(folder,this, "opacityFadeIn").name("Opacity fade in");



        this.addController(folder,this, "bpm").name("bpm");


        return this.__addFolder(folder);
    };

    stop  = () => {

    }

    update = (time, dt, audioData) => {
        const t = time + this.offset;
        const stepSize = 60 / this.bpm;
        const beatIndex = Math.floor(t / stepSize);

        let div = 4;
        if(beatIndex > this.speedUpThresh4X) {
            div = 0.5;
        }else if( beatIndex > this.speedUpThresh2X) {
            div = 1;
        }


        console.log(beatIndex)
        //this.redLight.intensity = beatIndex / 150;
        const idx = Math.floor(
            (beatIndex / div) % (this.textures.length - 1)
        );
        if(beatIndex >= this.chungusThresh - this.darkBeforeChungus && beatIndex < this.chungusThresh) {
            this.material.map =  null;
        }else if (beatIndex >= this.chungusThresh) {

          
            let t0 = 2;
            let z =  ((time - this.opacityFadeIn) / t0);
            z = z > 1.6 ? 1.6 : z;

            console.log("load chungus", z, (time - 62) / 3)

            this.mesh.scale.set(z,z,z);
            this.material.opacity = (time - 10) / 3;
            this.material.map = this.chungus;
        }else {
            this.material.map = this.textures[idx];
        }
        
        this.material.needsUpdate = true;
    };
}
