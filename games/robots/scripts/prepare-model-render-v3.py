"""Native paired review of the exact baked V3 browser poses. Does not save the scene."""
import bpy, os, json, math
from mathutils import Vector, Quaternion
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'assets-source','pose-review');os.makedirs(OUT,exist_ok=True)
with open(os.path.join(ROOT,'assets-source','combat-animation-library.json'),encoding='utf8') as f: library=json.load(f)
clips={c['name']:c for c in library['clips']}
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32
scene.render.resolution_x=1000;scene.render.resolution_y=720;scene.render.resolution_percentage=100
world=scene.world;world.use_nodes=True;world.node_tree.nodes.clear()
bg=world.node_tree.nodes.new('ShaderNodeBackground');bg.inputs[0].default_value=(.1,.14,.2,1);bg.inputs[1].default_value=.4
out=world.node_tree.nodes.new('ShaderNodeOutputWorld');world.node_tree.links.new(bg.outputs[0],out.inputs[0])
def light(name,loc,energy,color,size):
 d=bpy.data.lights.new(name,'AREA');d.energy=energy;d.color=color;d.size=size
 o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=loc;o.rotation_euler=(Vector((0,-1,1.1))-o.location).to_track_quat('-Z','Y').to_euler()
light('Key',(3,-4,6),900,(1,.84,.63),5);light('Fill',(-4,-1,3),700,(.4,.7,1),4);light('Rim',(1,4,5),1200,(.4,.8,1),3)
bpy.ops.mesh.primitive_plane_add(size=100,location=(0,0,-.025));floor=bpy.context.object
material=bpy.data.materials.new('Review_Floor');material.diffuse_color=(.016,.025,.04,1);floor.data.materials.append(material)
d=bpy.data.cameras.new('Review_Camera');camera=bpy.data.objects.new('Review_Camera',d);bpy.context.collection.objects.link(camera)
camera.location=(5,-6,3.4);d.type='ORTHO';scene.camera=camera
arm=bpy.data.objects['Automaton_Rig'];skin=bpy.data.objects['Automaton_Beetle_Skin'];arm.animation_data.action=None
victim=arm.copy();victim.data=arm.data.copy();victim.animation_data_clear();bpy.context.collection.objects.link(victim)
victim_skin=skin.copy();victim_skin.data=skin.data.copy();bpy.context.collection.objects.link(victim_skin);victim_skin.parent=victim
for modifier in victim_skin.modifiers:
 if modifier.type=='ARMATURE': modifier.object=victim
for i,material in enumerate(victim_skin.data.materials):
 clone=material.copy();victim_skin.data.materials[i]=clone
 if clone.node_tree and clone.node_tree.animation_data:
  for curve in clone.node_tree.animation_data.drivers:
   for variable in curve.driver.variables:
    for target in variable.targets:
     if target.id==arm: target.id=victim
def pose(target,name,frame):
 target.animation_data_clear()
 clip=clips[name]
 for bone in target.pose.bones: bone.rotation_mode='QUATERNION';bone.rotation_quaternion=(1,0,0,0);bone.location=(0,0,0)
 for name,values in clip['frames'][frame].items():
  x,y,z,w=values['q'];target.pose.bones[name].rotation_quaternion=Quaternion((w,x,y,z))
  if 'p' in values: target.pose.bones[name].location=values['p']
 for channel,signal in clip.get('signals',[{}]*len(clip['frames']))[frame].items():
  color=signal['color']
  if target==victim and channel=='reactor': color=[.0630100,.7156935,.8148466]
  for component,value in enumerate([*color,signal['intensity']]): target[f'signal_{channel}_{component}']=float(value)
def render(name,attacker_clip,attacker_frame,victim_clip=None,victim_frame=0,attacker_pos=(0,0,0),victim_pos=(0,-2.1,0)):
 arm.location=attacker_pos;arm.rotation_euler=(0,0,0);pose(arm,attacker_clip,attacker_frame)
 victim_skin.hide_render=victim_clip is None
 if victim_clip:
  victim.location=victim_pos;victim.rotation_euler=(0,0,math.pi);pose(victim,victim_clip,victim_frame)
 focus=Vector((0,-1.05 if victim_clip else 0,2.3 if attacker_clip=='burstAir' else 1.1))
 camera.rotation_euler=(focus-camera.location).to_track_quat('-Z','Y').to_euler();d.ortho_scale=6.2 if victim_clip else 5.6 if attacker_clip=='burstAir' else 4.8
 bpy.context.view_layer.update();scene.render.filepath=os.path.join(OUT,name+'.png');bpy.ops.render.render(write_still=True)
render('v3-grab-hold','grab',14,'grabbed',6)
render('v3-grab-throw','grab',19,'thrown',2,victim_pos=(0,-2.58,.18))
render('v3-grab-break','grabBreak',3,'grabBreak',3,attacker_pos=(0,.15,0),victim_pos=(0,-2.25,0))
render('v3-grab-whiff','grabWhiff',11)
render('v3-burst-ground','burst',3)
render('v3-burst-air','burstAir',3,attacker_pos=(0,0,1.2))
render('v3-feint','feint',4)
print('Rendered seven V3 native pose reviews to',OUT)
